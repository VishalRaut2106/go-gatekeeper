package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type Message struct {
	Type    string   `json:"type"`
	Data    string   `json:"data,omitempty"`
	Command string   `json:"command,omitempty"`
	Msg     string   `json:"msg,omitempty"`
	Hits    []string `json:"hits,omitempty"`
	Prefix  string   `json:"prefix,omitempty"`
	// room-aware fields
	RoomCode string `json:"roomCode,omitempty"`
	GuestURL string `json:"guestURL,omitempty"`
	Queue    int    `json:"queue,omitempty"`
}

type Room struct {
	mu         sync.Mutex
	Code       string
	Host       *websocket.Conn
	Guests     map[*websocket.Conn]bool
	GuestCount int // total guests ever connected
}

var (
	roomsMu    sync.RWMutex
	rooms      = make(map[string]*Room)
	baseDir    string
	port       = "8080"
	serverStart = time.Now()
	totalConns  int64
	connsMu     sync.Mutex
)

func init() {
	if p, err := os.Executable(); err == nil {
		d := filepath.Dir(p)
		if _, err2 := os.Stat(filepath.Join(d, "web")); err2 == nil {
			baseDir = d
			return
		}
	}
	baseDir = "."
	
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}
}

func generateCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

func getLocalIP() string {
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				if ip4 := ipnet.IP.To4(); ip4 != nil {
					return ip4.String()
				}
			}
		}
	}
	return "localhost"
}

func guestURL(code string, reqHost string) string {
	scheme := "http"
	if strings.Contains(reqHost, "render.com") || strings.Contains(reqHost, "railway.app") || strings.Contains(reqHost, "ngrok") || strings.Contains(reqHost, "fly.dev") {
		scheme = "https"
	} else if strings.Contains(reqHost, "localhost") {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/%s", scheme, reqHost, code)
}

func newRoom() *Room {
	var code string
	roomsMu.Lock()
	for {
		code = generateCode()
		if _, exists := rooms[code]; !exists {
			break
		}
	}
	r := &Room{
		Code:   code,
		Guests: make(map[*websocket.Conn]bool),
	}
	rooms[code] = r
	roomsMu.Unlock()
	log.Printf("[room %s] created", code)
	return r
}

func (r *Room) destroy() {
	roomsMu.Lock()
	delete(rooms, r.Code)
	roomsMu.Unlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	for g := range r.Guests {
		g.WriteJSON(Message{Type: "stderr", Data: "\nHost disconnected — session ended.\n"})
		g.Close()
	}
	log.Printf("[room %s] destroyed", r.Code)
}

func (r *Room) broadcastToGuests(msg Message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for g := range r.Guests {
		if err := g.WriteJSON(msg); err != nil {
			delete(r.Guests, g)
			g.Close()
		}
	}
}

func handleWebSocket(w http.ResponseWriter, req *http.Request) {
	role := req.URL.Query().Get("role")
	if role != "host" {
		role = "guest"
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("WS upgrade: %v", err)
		return
	}

	if role == "host" {
		r := newRoom()
		r.mu.Lock()
		r.Host = conn
		r.mu.Unlock()

		conn.WriteJSON(Message{
			Type:     "room_info",
			RoomCode: r.Code,
			GuestURL: guestURL(r.Code, req.Host),
		})

		log.Printf("[room %s] host connected", r.Code)
		go hostLoop(conn, r)

	} else {
		code := req.URL.Query().Get("code")
		roomsMu.RLock()
		r, ok := rooms[code]
		roomsMu.RUnlock()

		if !ok || code == "" {
			conn.WriteJSON(Message{Type: "stderr", Data: "Invalid or expired session code."})
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "invalid code"))
			conn.Close()
			return
		}

		r.mu.Lock()
		r.Guests[conn] = true
		r.mu.Unlock()

		log.Printf("[room %s] guest connected", r.Code)
		go guestLoop(conn, r)
	}
}

func hostLoop(conn *websocket.Conn, r *Room) {
	defer func() {
		conn.Close()
		log.Printf("[room %s] host disconnected", r.Code)
		r.destroy()
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		// Host sends stdout, stderr, completions, and status updates back to guests
		switch msg.Type {
		case "stdout", "stderr", "exit", "completions", "status":
			r.broadcastToGuests(msg)
		}
	}
}

func guestLoop(conn *websocket.Conn, r *Room) {
	defer func() {
		r.mu.Lock()
		delete(r.Guests, conn)
		r.mu.Unlock()
		conn.Close()
		log.Printf("[room %s] guest disconnected", r.Code)
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		// Guest sends commands to the host
		if msg.Type == "submit_command" || msg.Type == "complete" || msg.Type == "approval_request" {
			r.mu.Lock()
			if r.Host != nil {
				r.Host.WriteMessage(websocket.TextMessage, raw)
			}
			r.mu.Unlock()
		}
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	roomsMu.RLock()
	activeRooms := len(rooms)
	roomsMu.RUnlock()

	connsMu.Lock()
	total := totalConns
	connsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "ok",
		"uptime":      time.Since(serverStart).String(),
		"activeRooms": activeRooms,
		"totalConns":  total,
		"version":     "2.0.2",
	})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	roomsMu.RLock()
	type roomInfo struct {
		Code       string `json:"code"`
		Guests     int    `json:"guests"`
		GuestCount int    `json:"totalGuests"`
	}
	var infos []roomInfo
	for _, room := range rooms {
		room.mu.Lock()
		infos = append(infos, roomInfo{
			Code:       room.Code,
			Guests:     len(room.Guests),
			GuestCount: room.GuestCount,
		})
		room.mu.Unlock()
	}
	roomsMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rooms":  infos,
		"uptime": time.Since(serverStart).String(),
	})
}

func main() {
	webDir := filepath.Join(baseDir, "web")
	fs := http.FileServer(http.Dir(webDir))

	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/stats", handleStats)
	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || filepath.Ext(r.URL.Path) != "" {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

	fmt.Println("╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║         🛡️   GATEKEEPER SHELL CLOUD RELAY SERVER            ║")
	fmt.Println("╠══════════════════════════════════════════════════════════════╣")
	fmt.Printf( "║  Listening on port: %-40s ║\n", port)
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server: %v", err)
	}
}
