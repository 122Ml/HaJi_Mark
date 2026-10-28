package learning

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Adapted from Zhang Junchao's AS-01 service.go; preserve the exact UTF-8 answer.
func hashAnswer(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func blank(s string) bool { return strings.TrimSpace(s) == "" }
