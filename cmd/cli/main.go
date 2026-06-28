package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Message struct {
	Type     string   `json:"type"`
	Data     string   `json:"data,omitempty"`
	Command  string   `json:"command,omitempty"`
	Msg      string   `json:"msg,omitempty"`
	Hits     []string `json:"hits,omitempty"`
	Prefix   string   `json:"prefix,omitempty"`
	RoomCode string   `json:"roomCode,omitempty"`
	GuestURL string   `json:"guestURL,omitempty"`
	Queue    int      `json:"queue,omitempty"`
}

type PendingCmd struct {
	Command string
}

var (
	wsConn    *websocket.Conn
	shellBusy bool
	queue     []PendingCmd
	active    *PendingCmd
	mu        sync.Mutex
	isWin     = runtime.GOOS == "windows"
)

func main() {
	serverURL := flag.String("server", "ws://localhost:8080/ws?role=host", "Cloud Relay WebSocket URL")
	flag.Parse()

	log.SetFlags(0)

	u, err := url.Parse(*serverURL)
	if err != nil {
		log.Fatal("Invalid server URL:", err)
	}

	fmt.Printf("🛡️ Connecting to %s...\n", u.Host)

	var conn *websocket.Conn
	for i := 0; i < 5; i++ {
		conn, _, err = websocket.DefaultDialer.Dial(u.String(), nil)
		if err == nil {
			break
		}
		time.Sleep(1 * time.Second)
	}
	if err != nil {
		log.Fatalf("Failed to connect to relay server: %v", err)
	}
	wsConn = conn
	defer conn.Close()

	// Initial prompt to start the frontend state
	wsConn.WriteJSON(Message{Type: "stdout", Data: "$ "})

	// Handle messages from server
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				log.Println("Disconnected from server.")
				os.Exit(1)
			}
			var msg Message
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}

			switch msg.Type {
			case "room_info":
				fmt.Println("\n✅ Secure session started!")
				fmt.Printf("🔗 Give this link to your guest:\n   %s\n\n", msg.GuestURL)

			case "submit_command":
				enqueue(msg.Command)
			}
		}
	}()

	// Keep main thread alive for terminal input / approvals
	reader := bufio.NewReader(os.Stdin)
	for {
		mu.Lock()
		cmd := active
		mu.Unlock()

		if cmd != nil {
			fmt.Printf("\n⚠️ Guest wants to run: %s\nApprove? [Y/n]: ", cmd.Command)
			ans, _ := reader.ReadString('\n')
			ans = strings.TrimSpace(strings.ToLower(ans))

			mu.Lock()
			active = nil
			mu.Unlock()

			if ans == "" || ans == "y" {
				wsConn.WriteJSON(Message{Type: "status", Msg: ""})

				mu.Lock()
				shellBusy = true
				mu.Unlock()

				runCommand(cmd.Command)

				mu.Lock()
				shellBusy = false
				go processNext()
				mu.Unlock()
			} else {
				wsConn.WriteJSON(Message{Type: "status", Msg: ""})
				wsConn.WriteJSON(Message{Type: "stderr", Data: "\nCommand denied by host.\n"})
				wsConn.WriteJSON(Message{Type: "stdout", Data: "\n$ "})
				processNext()
			}
		} else {
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func enqueue(cmd string) {
	mu.Lock()
	defer mu.Unlock()
	queue = append(queue, PendingCmd{Command: cmd})
	if active == nil && !shellBusy {
		go processNext()
	} else {
		wsConn.WriteJSON(Message{
			Type:  "status",
			Msg:   fmt.Sprintf("Queued (position %d) — waiting for current command…", len(queue)),
			Queue: len(queue),
		})
	}
}

func processNext() {
	mu.Lock()
	defer mu.Unlock()
	if len(queue) == 0 {
		active = nil
		return
	}
	active = &queue[0]
	queue = queue[1:]

	wsConn.WriteJSON(Message{
		Type: "status",
		Msg:  "Waiting for host approval…",
	})

	wsConn.WriteJSON(Message{
		Type:    "approval_request",
		Command: active.Command,
		Queue:   len(queue),
	})
}

// runCommand executes a command, processing built-ins first
func runCommand(line string) {
	defer wsConn.WriteJSON(Message{Type: "stdout", Data: "\n$ "})

	line = strings.TrimSpace(line)
	if line == "" {
		return
	}

	parts := strings.Fields(line)
	if len(parts) == 0 {
		return
	}
	cmdName := strings.ToLower(parts[0])

	switch cmdName {
	case "cd":
		target := "."
		if len(parts) > 1 {
			target = parts[1]
		}
		if target == "~" {
			target, _ = os.UserHomeDir()
		}
		err := os.Chdir(target)
		if err != nil {
			msg := fmt.Sprintf("cd: %v\n", err)
			fmt.Fprintln(os.Stderr, msg)
			wsConn.WriteJSON(Message{Type: "stderr", Data: msg})
		}
		return
	case "pwd":
		dir, _ := os.Getwd()
		fmt.Println(dir)
		wsConn.WriteJSON(Message{Type: "stdout", Data: dir + "\n"})
		return
	case "clear", "cls":
		return
	case "exit", "quit":
		wsConn.WriteJSON(Message{Type: "stdout", Data: "Session ended.\n"})
		os.Exit(0)
	}

	// System command
	var cmd *exec.Cmd
	if isWin {
		cmd = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", line)
	} else {
		cmd = exec.Command("/bin/bash", "-c", line)
	}

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		wsConn.WriteJSON(Message{Type: "stderr", Data: fmt.Sprintf("%s: command not found\n", parts[0])})
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			text := scanner.Text()
			fmt.Println(text)
			wsConn.WriteJSON(Message{Type: "stdout", Data: text + "\n"})
		}
		if err := scanner.Err(); err != nil {
			log.Printf("stdout scanner error: %v\n", err)
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			text := scanner.Text()
			fmt.Fprintln(os.Stderr, text)
			wsConn.WriteJSON(Message{Type: "stderr", Data: text + "\n"})
		}
		if err := scanner.Err(); err != nil {
			log.Printf("stderr scanner error: %v\n", err)
		}
	}()

	wg.Wait()
	cmd.Wait()
}
