package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCryptographicRandomReadsFailFast(t *testing.T) {
	tests := []struct {
		name string
		call func()
	}{
		{"initE2E", func() {
			initE2E()
		}},
		{"encrypt nonce", func() {
			e2eKey = make([]byte, 32)
			encrypt("secret")
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			envName := "GO_GATEKEEPER_RAND_FAILURE_" + strings.ReplaceAll(tc.name, " ", "_")
			if os.Getenv(envName) == "1" {
				cryptoRandRead = func([]byte) (int, error) {
					return 0, errors.New("simulated CSPRNG failure")
				}
				tc.call()
				os.Exit(0)
			}

			cmd := exec.Command(os.Args[0], "-test.run=^TestCryptographicRandomReadsFailFast$/"+strings.ReplaceAll(tc.name, " ", "_")+"$")
			cmd.Env = append(os.Environ(), envName+"=1")
			output, err := cmd.CombinedOutput()
			if err == nil {
				t.Fatalf("%s succeeded after crypto/rand failure", tc.name)
			}
			if !strings.Contains(string(output), "crypto/rand unavailable") {
				t.Fatalf("%s did not report crypto/rand failure: %s", tc.name, output)
			}
		})
	}
}
