package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

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

type Client struct {
	room *Room
	conn *websocket.Conn
	send chan Message
	role string // "host" or "guest"
}

type Room struct {
	Code       string
	Host       *Client
	Guests     map[*Client]bool
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	done       chan struct{}
	closeOnce  sync.Once

	mu         sync.Mutex // Protects metadata and Guests map during iteration
	GuestCount int
}

var (
	roomsMu     sync.RWMutex
	rooms       = make(map[string]*Room)
	baseDir     string
	port        = "8080"
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
	_, _ = rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
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
		Code:       code,
		Guests:     make(map[*Client]bool),
		broadcast:  make(chan Message),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		done:       make(chan struct{}),
	}
	rooms[code] = r
	roomsMu.Unlock()

	go r.run() // Start the highly concurrent Hub goroutine
	log.Printf("[room %s] created", code)
	return r
}

func (r *Room) destroy() {
	roomsMu.Lock()
	delete(rooms, r.Code)
	roomsMu.Unlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	for guest := range r.Guests {
		select {
		case guest.send <- Message{Type: "stderr", Data: "\nHost disconnected — session ended.\n"}:
		default:
		}
		close(guest.send)
		delete(r.Guests, guest)
	}
	log.Printf("[room %s] destroyed", r.Code)
	r.closeOnce.Do(func() {
		close(r.done)
	})
}

// run is the central message router for the room.
// It handles all synchronization and prevents Head-of-Line blocking.
func (r *Room) run() {
	for {
		select {
		case client := <-r.register:
			if client.role == "guest" {
				r.mu.Lock()
				r.Guests[client] = true
				r.GuestCount++
				r.mu.Unlock()
				log.Printf("[room %s] guest connected", r.Code)
			} else {
				r.Host = client
				log.Printf("[room %s] host connected", r.Code)
			}

		case client := <-r.unregister:
			if client.role == "guest" {
				r.mu.Lock()
				if _, ok := r.Guests[client]; ok {
					delete(r.Guests, client)
					close(client.send)
					log.Printf("[room %s] guest disconnected", r.Code)
				}
				r.mu.Unlock()
			} else if client.role == "host" {
				log.Printf("[room %s] host disconnected", r.Code)
				r.destroy()
				return // Terminate the room's goroutine
			}

		case message := <-r.broadcast:
			// Route messages based on type
			if message.Type == "submit_command" || message.Type == "complete" || message.Type == "approval_request" {
				// Guest commands go ONLY to the host
				if r.Host != nil {
					select {
					case r.Host.send <- message:
					default:
						// Host channel buffer full or dead
					}
				}
			} else {
				// Host outputs (stdout, stderr, status) go to all guests
				r.mu.Lock()
				for guest := range r.Guests {
					select {
					case guest.send <- message:
					default:
						// Guest is too slow, their channel is full.
						// Disconnect them to prevent holding up the server.
						close(guest.send)
						delete(r.Guests, guest)
					}
				}
				r.mu.Unlock()
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		select {
		case c.room.unregister <- c:
		case <-c.room.done:
		}
		c.conn.Close()
	}()
	for {
		var msg Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			break
		}
		c.room.broadcast <- msg
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteJSON(msg); err != nil {
			return
		}
	}
}

var (
	ipLimiters sync.Map // map[string]*rate.Limiter
)

// clientIP extracts the real client IP, accounting for Render's reverse
// proxy. Trusts X-Forwarded-For first (first hop = original client),
// falls back to X-Real-IP, then RemoteAddr for direct/local connections.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// allowConnection enforces 10 WebSocket upgrade requests per minute per IP.
func allowConnection(ip string) bool {
	limiterI, _ := ipLimiters.LoadOrStore(ip, rate.NewLimiter(rate.Every(6*time.Second), 10))
	limiter := limiterI.(*rate.Limiter)
	return limiter.Allow()
}

// cleanupStaleLimiters periodically evicts limiters that are fully idle
// (token bucket back at full burst capacity) so ipLimiters doesn't grow
// unbounded over long-running server uptime.
func cleanupStaleLimiters() {
	for {
		time.Sleep(10 * time.Minute)
		ipLimiters.Range(func(key, value interface{}) bool {
			limiter := value.(*rate.Limiter)
			if limiter.Tokens() >= 10 {
				ipLimiters.Delete(key)
			}
			return true
		})
	}
}

func handleWebSocket(w http.ResponseWriter, req *http.Request) {
	ip := clientIP(req)
	if !allowConnection(ip) {
		http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
		log.Printf("rate limit: rejected %s", ip)
		return
	}

	connsMu.Lock()
	totalConns++
	connsMu.Unlock()

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
		client := &Client{room: r, conn: conn, send: make(chan Message, 256), role: "host"}
		r.register <- client

		client.send <- Message{
			Type:     "room_info",
			RoomCode: r.Code,
			GuestURL: guestURL(r.Code, req.Host),
		}

		go client.writePump()
		go client.readPump()

	} else {
		code := req.URL.Query().Get("code")
		roomsMu.RLock()
		r, ok := rooms[code]
		roomsMu.RUnlock()

		if !ok || code == "" {
			_ = conn.WriteJSON(Message{Type: "stderr", Data: "Invalid or expired session code."})
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "invalid code"))
			conn.Close()
			return
		}

		client := &Client{room: r, conn: conn, send: make(chan Message, 256), role: "guest"}
		r.register <- client

		go client.writePump()
		go client.readPump()
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
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "ok",
		"uptime":      time.Since(serverStart).String(),
		"activeRooms": activeRooms,
		"totalConns":  total,
		"version":     "2.1.2",
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
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"rooms":  infos,
		"uptime": time.Since(serverStart).String(),
	})
}

// shutdownServer notifies every connected client (host + guests) across
// all active rooms that the server is restarting, then tears each room
// down via the existing destroy() path (reusing the done/closeOnce
// machinery from #7/#8) so no goroutines leak during shutdown.
func shutdownServer() {
	roomsMu.RLock()
	active := make([]*Room, 0, len(rooms))
	for _, r := range rooms {
		active = append(active, r)
	}
	roomsMu.RUnlock()

	notice := Message{Type: "stderr", Data: "\nServer is restarting, please reconnect shortly.\n"}
	for _, r := range active {
		r.mu.Lock()
		if r.Host != nil {
			select {
			case r.Host.send <- notice:
			default:
			}
		}
		for guest := range r.Guests {
			select {
			case guest.send <- notice:
			default:
			}
		}
		r.mu.Unlock()
		r.destroy()
	}
	log.Printf("shutdown: drained %d active room(s)", len(active))
}

func main() {
	go cleanupStaleLimiters()

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
	fmt.Printf("║  Listening on port: %-40s ║\n", port)
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")

	srv := &http.Server{Addr: ":" + port}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh

	log.Println("shutdown signal received, draining active rooms...")
	shutdownServer()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
	log.Println("server exited cleanly")
}
