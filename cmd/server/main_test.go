package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func countGoroutines() int {
	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	return runtime.NumGoroutine()
}

func waitForGoroutineCount(t *testing.T, want int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var last int
	for time.Now().Before(deadline) {
		last = countGoroutines()
		if last <= want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("goroutine leak: want <= %d, got %d after %s", want, last, timeout)
}

func TestNoGoroutineLeakOnHostDisconnectWithGuestConnected(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	baseline := countGoroutines()

	hostConn, _, err := websocket.DefaultDialer.Dial(wsURL+"?role=host", nil)
	if err != nil {
		t.Fatalf("host dial: %v", err)
	}

	var roomInfo Message
	if err := hostConn.ReadJSON(&roomInfo); err != nil {
		t.Fatalf("host read room_info: %v", err)
	}
	if roomInfo.RoomCode == "" {
		t.Fatalf("expected room code in room_info, got %+v", roomInfo)
	}

	guestURL := fmt.Sprintf("%s?role=guest&code=%s", wsURL, roomInfo.RoomCode)
	guestConn, _, err := websocket.DefaultDialer.Dial(guestURL, nil)
	if err != nil {
		t.Fatalf("guest dial: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	hostConn.Close()

	go func() {
		for {
			if _, _, err := guestConn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	waitForGoroutineCount(t, baseline+1, 2*time.Second)

	guestConn.Close()
}

func TestRateLimitRejectsExcessRequests(t *testing.T) {
	ipLimiters = sync.Map{}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?role=guest&code=doesnotmatter"

	var rejected int
	for i := 0; i < 11; i++ {
		conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err == nil {
			conn.Close()
			continue
		}
		if resp != nil && resp.StatusCode == http.StatusTooManyRequests {
			rejected++
		}
	}

	if rejected == 0 {
		t.Fatalf("expected at least one 429 after 11 rapid requests from the same IP, got none")
	}
}

func TestIsAllowedOrigin(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{"empty origin (non-browser client)", "", true},
		{"render.com exact", "https://gatekeeper-relay.onrender.com", true},
		{"onrender.com subdomain", "https://staging.gatekeeper-relay.onrender.com", true},
		{"railway.app", "https://myapp.railway.app", true},
		{"localhost", "http://localhost:3000", true},
		{"127.0.0.1", "http://127.0.0.1:3000", true},
		{"vishalraut.me subdomain", "https://gatekeeper.vishalraut.me", true},
		{"vishalraut.me exact", "https://vishalraut.me", true},
		{"spoofed lookalike domain", "https://evilrender.com", false},
		{"spoofed suffix domain", "https://sub.render.com.attacker.net", false},
		{"unrelated domain", "https://attacker.com", false},
		{"malformed origin", "not a url", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isAllowedOrigin(tc.origin)
			if got != tc.want {
				t.Errorf("isAllowedOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestStatsDoesNotExposeRoomCode(t *testing.T) {
	newRoom()

	req := httptest.NewRequest("GET", "/stats", nil)
	w := httptest.NewRecorder()
	handleStats(w, req)

	body := w.Body.String()
	if strings.Contains(body, `"code"`) {
		t.Fatalf("/stats response must not contain a \"code\" field, got: %s", body)
	}
}

func TestGenerateCodeEntropy(t *testing.T) {
	code := generateCode()
	if len(code) != 10 {
		t.Errorf("expected generateCode() to produce a 10-char code (5 random bytes), got %d chars: %q", len(code), code)
	}
}

func TestShutdownServerDrainsActiveRooms(t *testing.T) {
	r := newRoom()
	host := &Client{room: r, send: make(chan Message, 4), role: "host"}
	guest := &Client{room: r, send: make(chan Message, 4), role: "guest"}

	r.mu.Lock()
	r.Host = host
	r.Guests[guest] = true
	r.mu.Unlock()

	shutdownServer()

	select {
	case msg := <-host.send:
		if msg.Data == "" {
			t.Errorf("expected non-empty shutdown notice for host")
		}
	default:
		t.Errorf("expected host to receive a shutdown notice")
	}

	select {
	case msg := <-guest.send:
		if msg.Data == "" {
			t.Errorf("expected non-empty shutdown notice for guest")
		}
	default:
		t.Errorf("expected guest to receive a shutdown notice")
	}

	roomsMu.RLock()
	_, exists := rooms[r.Code]
	roomsMu.RUnlock()
	if exists {
		t.Errorf("expected room %s to be removed from rooms map after shutdown", r.Code)
	}
}

func TestReadPumpEnforcesMessageSizeLimit(t *testing.T) {
	ipLimiters = sync.Map{}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?role=host"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	var roomInfo Message
	if err := conn.ReadJSON(&roomInfo); err != nil {
		t.Fatalf("read room_info: %v", err)
	}

	// Send a message well over maxMessageSize (32KB) — the server should
	// close the connection rather than allocate unbounded memory for it.
	oversized := Message{Type: "stdout", Data: strings.Repeat("A", maxMessageSize+1024)}
	if err := conn.WriteJSON(oversized); err != nil {
		t.Fatalf("write oversized message: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatalf("expected connection to be closed after oversized message, but read succeeded")
	}
}
