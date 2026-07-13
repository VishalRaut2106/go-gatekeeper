package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

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
