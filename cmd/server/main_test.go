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

// countGoroutines lets short-lived scheduler noise settle before sampling,
// so the count reflects genuinely live goroutines, not GC/runtime jitter.
func countGoroutines() int {
	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	return runtime.NumGoroutine()
}

// waitForGoroutineCount polls until NumGoroutine drops to at most `want`,
// or fails the test after timeout. This is the standard idiom for
// goroutine-leak tests: teardown is async, so we can't assert immediately.
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

	// --- host connects ---
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

	// --- guest connects to the same room ---
	guestURL := fmt.Sprintf("%s?role=guest&code=%s", wsURL, roomInfo.RoomCode)
	guestConn, _, err := websocket.DefaultDialer.Dial(guestURL, nil)
	if err != nil {
		t.Fatalf("guest dial: %v", err)
	}

	// let both registrations settle on the room's run() goroutine
	time.Sleep(100 * time.Millisecond)

	// --- simulate host disconnect while a guest is still connected ---
	hostConn.Close()

	// The server will forcibly close the guest's connection too (via
	// destroy() closing guest.send). Drain reads until that happens so
	// this goroutine itself doesn't skew the count.
	go func() {
		for {
			if _, _, err := guestConn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// Before the fix, a leaked readPump goroutine per guest means this
	// never converges back to baseline and the test times out/fails.
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
