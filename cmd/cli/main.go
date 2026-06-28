package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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

	shellCmd *exec.Cmd
	shellIn  io.WriteCloser
	shellOut io.ReadCloser
	shellErr io.ReadCloser
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

	startShell()

	// Initial prompt to start the frontend state with the correct path
	sendPrompt(false)

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

	// Read Stdin concurrently
	inputChan := make(chan string)
	go func() {
		reader := bufio.NewReader(os.Stdin)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				break
			}
			inputChan <- line
		}
	}()

	printHostPrompt(true)
	promptPrinted := false

	// Keep main thread alive for terminal input / approvals
	for {
		mu.Lock()
		cmd := active
		mu.Unlock()

		if cmd != nil && !promptPrinted {
			path := getFormattedPath()
			if isDangerous(cmd.Command) {
				fmt.Printf("\n\x1b[31;1m🚨 WARNING: DANGEROUS COMMAND DETECTED 🚨\x1b[0m\nGuest ➜ %s> \x1b[31;1m%s\x1b[0m\nApprove? [Y/n]: ", path, cmd.Command)
			} else {
				fmt.Printf("\nGuest ➜ %s> %s\nApprove? [Y/n]: ", path, cmd.Command)
			}
			promptPrinted = true
		}

		select {
		case line := <-inputChan:
			line = strings.TrimSpace(line)
			if cmd != nil {
				ans := strings.ToLower(line)
				mu.Lock()
				active = nil
				mu.Unlock()
				promptPrinted = false

				if ans == "" || ans == "y" {
					wsConn.WriteJSON(Message{Type: "status", Msg: ""})

					mu.Lock()
					shellBusy = true
					mu.Unlock()

					runCommand(cmd.Command)
				} else {
					wsConn.WriteJSON(Message{Type: "status", Msg: ""})
					wsConn.WriteJSON(Message{Type: "stderr", Data: "\nCommand denied by host.\n"})
					sendPrompt(true)
					processNext()
				}
				printHostPrompt(false)
			} else {
				if line != "" {
					wsConn.WriteJSON(Message{Type: "stdout", Data: "\x1b[32m$ " + line + "\x1b[0m\n"})
					mu.Lock()
					shellBusy = true
					mu.Unlock()

					runCommand(line)
				}
				printHostPrompt(false)
			}
		case <-time.After(100 * time.Millisecond):
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

const cmdDoneMarker = "---GATEKEEPER_CMD_DONE---"

func startShell() {
	if isWin {
		shellCmd = exec.Command("powershell.exe", "-NoProfile")
	} else {
		shellCmd = exec.Command("/bin/bash")
	}

	shellIn, _ = shellCmd.StdinPipe()
	shellOut, _ = shellCmd.StdoutPipe()
	shellErr, _ = shellCmd.StderrPipe()

	err := shellCmd.Start()
	if err != nil {
		log.Fatal("Failed to start background shell:", err)
	}

	go func() {
		scanner := bufio.NewScanner(shellOut)
		for scanner.Scan() {
			text := scanner.Text()
			if strings.TrimSpace(text) == cmdDoneMarker {
				mu.Lock()
				shellBusy = false
				go processNext()
				mu.Unlock()
				sendPrompt(true)
				continue
			}
			fmt.Println(text)
			wsConn.WriteJSON(Message{Type: "stdout", Data: text + "\n"})
		}
	}()

	go func() {
		scanner := bufio.NewScanner(shellErr)
		for scanner.Scan() {
			text := scanner.Text()
			fmt.Fprintln(os.Stderr, text)
			wsConn.WriteJSON(Message{Type: "stderr", Data: text + "\n"})
		}
	}()
}

func isDangerous(cmd string) bool {
	parts := strings.Fields(strings.ToLower(cmd))
	dangerous := map[string]bool{
		"rm": true, "del": true, "format": true, "sudo": true,
		"remove-item": true, "set-executionpolicy": true, "drop": true,
	}
	for _, p := range parts {
		if dangerous[p] {
			return true
		}
	}
	return false
}

// runCommand executes a command by piping it to the persistent shell
func runCommand(line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		mu.Lock()
		shellBusy = false
		go processNext()
		mu.Unlock()
		sendPrompt(true)
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
			target = strings.Join(parts[1:], " ")
		}
		if target == "~" {
			target, _ = os.UserHomeDir()
		}
		os.Chdir(target)
	case "pwd":
		dir, _ := os.Getwd()
		fmt.Println(dir)
		wsConn.WriteJSON(Message{Type: "stdout", Data: dir + "\n"})
	case "clear", "cls":
		mu.Lock()
		shellBusy = false
		go processNext()
		mu.Unlock()
		sendPrompt(true)
		return
	case "exit", "quit":
		wsConn.WriteJSON(Message{Type: "stdout", Data: "Session ended.\n"})
		os.Exit(0)
	}

	var wrappedCmd string
	if isWin {
		wrappedCmd = fmt.Sprintf("%s\r\nWrite-Output '%s'\r\n", line, cmdDoneMarker)
	} else {
		wrappedCmd = fmt.Sprintf("%s\necho '%s'\n", line, cmdDoneMarker)
	}

	_, err := shellIn.Write([]byte(wrappedCmd))
	if err != nil {
		wsConn.WriteJSON(Message{Type: "stderr", Data: fmt.Sprintf("Failed to run command: %v\n", err)})
		mu.Lock()
		shellBusy = false
		go processNext()
		mu.Unlock()
		sendPrompt(true)
	}
}

func getFormattedPath() string {
	dir, err := os.Getwd()
	if err != nil {
		return "~"
	}
	home, err := os.UserHomeDir()
	if err == nil && strings.HasPrefix(dir, home) {
		dir = "~" + strings.TrimPrefix(dir, home)
	}
	return dir
}

func printHostPrompt(leadingNewline bool) {
	path := getFormattedPath()
	if leadingNewline {
		fmt.Printf("\n%s> ", path)
	} else {
		fmt.Printf("%s> ", path)
	}
}

func sendPrompt(leadingNewline bool) {
	path := getFormattedPath()
	prompt := path + "> "
	if leadingNewline {
		prompt = "\n" + prompt
	}
	wsConn.WriteJSON(Message{Type: "stdout", Data: prompt})
}
