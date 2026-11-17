package learning

import (
	"strings"
	"testing"
)

func TestReadAnswerCSV(t *testing.T) {
	input := "\ufeffusername,answer_text\r\nstudent,\"首行😀\r\n原文有,逗号和\"\"引号\"\"\"\r\n\r\npeer,  保留空格  \r\n"
	rows, err := readAnswerCSV(input)
	if err != nil || len(rows) != 2 {
		t.Fatal(rows, err)
	}
	if rows[0].Answer != "首行😀\r\n原文有,逗号和\"引号\"" || rows[1].Answer != "  保留空格  " || rows[1].Row != 5 {
		t.Fatalf("original answer or source line changed: %#v", rows)
	}
	for _, content := range []string{"", "user,answer\ns,a", "username,answer_text\ns,a,b", "username,answer_text\ns,\"unclosed", "username,answer_text\n", "username,answer_text\ns," + strings.Repeat("x", 513<<10), "username,answer_text\ns,\xff", "username,answer_text\n" + strings.Repeat("s,a\n", 201)} {
		if _, err := readAnswerCSV(content); err == nil {
			t.Fatal("invalid CSV accepted", len(content))
		}
	}
	rows, err = readAnswerCSV("username,answer_text\ns,first\ns,second\nblank,  \n,answer\nlarge," + strings.Repeat("x", 200001))
	if err != nil || len(rows) != 5 || rows[0].Error != "" {
		t.Fatal(err, len(rows))
	}
	for _, row := range rows[1:] {
		if row.Error == "" {
			t.Fatalf("missing row error: %#v", row)
		}
	}
}
