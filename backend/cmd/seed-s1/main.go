// seed-s1 creates local-only accounts. Credentials stay in the mounted ignored
// output file; stdout contains only IDs and a success message.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type account struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"display_name"`
	Role     string `json:"role"`
	Password string `json:"password"`
}
type fixtures struct {
	Accounts          []account `json:"accounts"`
	CourseID          string    `json:"course_id"`
	OtherCourseID     string    `json:"other_course_id"`
	DraftCourseID     string    `json:"draft_course_id"`
	KnowledgePointIDs []string  `json:"knowledge_point_ids"`
}

func newFixtures() (fixtures, error) {
	f := fixtures{CourseID: uuid.NewString(), OtherCourseID: uuid.NewString(), DraftCourseID: uuid.NewString(), KnowledgePointIDs: []string{uuid.NewString(), uuid.NewString()}}
	for i, name := range []string{"s1-teacher", "s1-teacher-other", "s1-student-a", "s1-student-b"} {
		password := make([]byte, 16)
		if _, err := rand.Read(password); err != nil {
			return f, err
		}
		role := "student"
		if i < 2 {
			role = "teacher"
		}
		f.Accounts = append(f.Accounts, account{ID: uuid.NewString(), Username: name, Name: []string{"S1教师T", "S1教师U", "S1学生A", "S1学生B"}[i], Role: role, Password: hex.EncodeToString(password)})
	}
	return f, nil
}

func run(output string) error {
	var f fixtures
	data, err := os.ReadFile(output)
	if os.IsNotExist(err) {
		f, err = newFixtures()
		if err != nil {
			return err
		}
		data, err = json.MarshalIndent(f, "", "  ")
		if err != nil {
			return err
		}
		if err = os.MkdirAll(filepath.Dir(output), 0700); err != nil {
			return err
		}
		// Persist before starting the transaction, so retries reuse IDs and passwords.
		file, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = file.Write(data)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	} else if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &f); err != nil {
		return fmt.Errorf("invalid local seed file")
	}
	if len(f.Accounts) != 4 || len(f.KnowledgePointIDs) != 2 {
		return fmt.Errorf("invalid local fixture count")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, platform.LoadConfig().DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	for i, a := range f.Accounts {
		if a.Username != []string{"s1-teacher", "s1-teacher-other", "s1-student-a", "s1-student-b"}[i] || (i < 2 && a.Role != "teacher") || (i >= 2 && a.Role != "student") || len(a.Password) < 16 || len(a.Password) > 72 {
			return fmt.Errorf("invalid local account configuration")
		}
		if _, err := uuid.Parse(a.ID); err != nil {
			return fmt.Errorf("invalid account ID")
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(a.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		if err := q.CreateLocalUser(ctx, store.CreateLocalUserParams{ID: a.ID, Username: pgtype.Text{String: a.Username, Valid: true}, DisplayName: a.Name, Role: a.Role, PasswordHash: pgtype.Text{String: string(hashed), Valid: true}}); err != nil {
			return err
		}
		saved, err := q.GetLoginUser(ctx, pgtype.Text{String: a.Username, Valid: true})
		if err != nil {
			return err
		}
		if saved.ID != a.ID || saved.Role != a.Role || bcrypt.CompareHashAndPassword([]byte(saved.PasswordHash.String), []byte(a.Password)) != nil {
			return fmt.Errorf("local account already exists with a different identity/password; not overwritten")
		}
	}
	for _, c := range []store.CreateLocalCourseParams{
		{ID: f.CourseID, Title: "S1软件测试（构造课程）", TeacherID: f.Accounts[0].ID, Status: "published"},
		{ID: f.OtherCourseID, Title: "S1另一教师的课程", TeacherID: f.Accounts[1].ID, Status: "published"},
		{ID: f.DraftCourseID, Title: "S1未发布课程", TeacherID: f.Accounts[0].ID, Status: "draft"},
	} {
		if _, err := uuid.Parse(c.ID); err != nil {
			return fmt.Errorf("invalid course ID")
		}
		if err := q.CreateLocalCourse(ctx, c); err != nil {
			return err
		}
	}
	for _, a := range f.Accounts[2:] {
		if err := q.CreateLocalEnrollment(ctx, store.CreateLocalEnrollmentParams{CourseID: f.CourseID, StudentID: a.ID}); err != nil {
			return err
		}
	}
	for i, id := range f.KnowledgePointIDs {
		if _, err := uuid.Parse(id); err != nil {
			return fmt.Errorf("invalid knowledge point ID")
		}
		if err := q.CreateLocalKnowledgePoint(ctx, store.CreateLocalKnowledgePointParams{ID: id, CourseID: f.CourseID, Title: []string{"边界与合法性", "等价类划分"}[i], Position: int32(i)}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	fmt.Printf("S1 local accounts ready; course_id=%s; credentials in %s (not printed)\n", f.CourseID, output)
	return nil
}

func main() {
	output := flag.String("output", "/local/s1-accounts.json", "ignored local credential file")
	flag.Parse()
	if err := run(*output); err != nil {
		fmt.Fprintln(os.Stderr, "seed-s1:", err)
		os.Exit(1)
	}
}
