//go:build !unix

package rag

import "os/exec"

func configureParserCommand(cmd *exec.Cmd) {}
