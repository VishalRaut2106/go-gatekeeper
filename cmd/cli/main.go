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
	shellIn   io.WriteCloser
	shellBusy bool
	queue     []PendingCmd
	active    *PendingCmd
	mu        sync.Mutex
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

			case "complete":
				// For tab completion, we can ask system_shell or do it here. 
				// For now, basic complete can be handled here or just ignored for simplicity.
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
			fmt.Printf("\n⚠️ Guest wants to run: %s\nApprove? [y/N]: ", cmd.Command)
			ans, _ := reader.ReadString('\n')
			ans = strings.TrimSpace(strings.ToLower(ans))
			
			mu.Lock()
			active = nil
			mu.Unlock()

			if ans == "y" {
				wsConn.WriteJSON(Message{Type: "status", Msg: ""})
				
				mu.Lock()
				shellBusy = true
				mu.Unlock()
				
				shellIn.Write([]byte(cmd.Command + "\n"))
			} else {
				wsConn.WriteJSON(Message{Type: "status", Msg: ""})
				wsConn.WriteJSON(Message{Type: "stderr", Data: "\nCommand denied by host.\n"})
				wsConn.WriteJSON(Message{Type: "stdout", Data: "\n$ "})
				processNext()
			}
		} else {
			// If not actively prompting for approval, sleep a bit.
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
		Type: "approval_request",
		Command: active.Command,
		Queue: len(queue),
	})
}

func startShell() {
	// Find system_shell.js 
	// For simplicity, assuming it's in the current dir or parent dir
	var scriptPath string
	if _, err := os.Stat("system_shell.js"); err == nil {
		scriptPath = "system_shell.js"
	} else if _, err := os.Stat("../system_shell.js"); err == nil {
		scriptPath = "../system_shell.js"
	} else {
		scriptPath = "../../system_shell.js"
	}

	cmd := exec.Command("node", scriptPath)
	cmd.Env = append(os.Environ(), "TERM=dumb")

	var err error
	shellIn, err = cmd.StdinPipe()
	if err != nil {
		log.Fatal("StdinPipe:", err)
	}

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		log.Fatal("shell start:", err)
	}

	go pipeOutput(stdout, "stdout")
	go pipeOutput(stderr, "stderr")
}

func pipeOutput(src io.Reader, msgType string) {
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			data := string(buf[:n])
			if wsConn != nil {
				wsConn.WriteJSON(Message{Type: msgType, Data: data})
			}
			if msgType == "stdout" && isPrompt(data) {
				mu.Lock()
				if shellBusy {
					shellBusy = false
					go processNext()
				}
				mu.Unlock()
			}
		}
		if err != nil {
			break
		}
	}
}

func isPrompt(data string) bool {
	trimmed := strings.TrimRight(data, " \n")
	return data == "$ " || data == "$ \n" ||
		strings.HasSuffix(trimmed, "\n$") ||
		strings.Contains(data, "\n$ ")
}
