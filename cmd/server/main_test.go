package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
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
		{"fly.dev subdomain", "https://gatekeeper.fly.dev", true},
		{"ngrok-free.app subdomain", "https://random-subdomain.ngrok-free.app", true},
		{"ngrok.io subdomain", "https://tunnel.ngrok.io", true},
		{"ngrok.app subdomain", "https://dev.ngrok.app", true},
		{"localhost with port", "http://localhost:8080", true},
		{"localhost 3000", "http://localhost:3000", true},
		{"127.0.0.1 with port", "http://127.0.0.1:8080", true},
		{"127.0.0.1 3000", "http://127.0.0.1:3000", true},
		{"vishalraut.me subdomain", "https://gatekeeper.vishalraut.me", true},
		{"vishalraut.me exact", "https://vishalraut.me", true},
		{"null origin", "null", false},
		{"spoofed lookalike domain", "https://evilrender.com", false},
		{"spoofed suffix domain", "https://sub.render.com.attacker.net", false},
		{"unrelated domain", "https://attacker.com", false},
		{"malformed origin", "not a url", false},
		{"ftp scheme disallowed", "ftp://gatekeeper.vishalraut.me", false},
		{"javascript scheme disallowed", "javascript:void(0)", false},
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

func TestIsAllowedOriginWithEnvVar(t *testing.T) {
	orig := os.Getenv("ALLOWED_ORIGINS")
	defer os.Setenv("ALLOWED_ORIGINS", orig)

	os.Setenv("ALLOWED_ORIGINS", "https://custom.example.com, http://internal.local:9000, allowed-domain.org")

	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{"exact match from env", "https://custom.example.com", true},
		{"exact match with port from env", "http://internal.local:9000", true},
		{"domain match from env", "https://allowed-domain.org", true},
		{"subdomain match from env", "https://sub.allowed-domain.org", true},
		{"unlisted domain still rejected", "https://disallowed.example.com", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isAllowedOrigin(tc.origin)
			if got != tc.want {
				t.Errorf("isAllowedOrigin(%q) with env = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestWebSocketUpgraderCheckOrigin(t *testing.T) {
	cases := []struct {
		name       string
		origin     string
		wantAccept bool
	}{
		{"cli direct (no origin)", "", true},
		{"legitimate browser gatekeeper domain", "https://gatekeeper.vishalraut.me", true},
		{"legitimate browser localhost", "http://localhost:8080", true},
		{"malicious third party website", "https://attacker.com", false},
		{"null origin in browser sandbox", "null", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest("GET", "/ws", nil)
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			accepted := upgrader.CheckOrigin(req)
			if accepted != tc.wantAccept {
				t.Errorf("CheckOrigin(Origin: %q) = %v, want %v", tc.origin, accepted, tc.wantAccept)
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

func TestGenerateCodeFailsOnRandFailure(t *testing.T) {
	if os.Getenv("GO_GATEKEEPER_RAND_FAILURE") == "1" {
		cryptoRandRead = func([]byte) (int, error) {
			return 0, errors.New("simulated CSPRNG failure")
		}
		generateCode()
		os.Exit(0)
	}

	cmd := exec.Command(os.Args[0], "-test.run=^TestGenerateCodeFailsOnRandFailure$")
	cmd.Env = append(os.Environ(), "GO_GATEKEEPER_RAND_FAILURE=1")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("generateCode() succeeded after crypto/rand failure")
	}
	if !strings.Contains(string(output), "crypto/rand unavailable") {
		t.Fatalf("generateCode() did not report crypto/rand failure: %s", output)
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
