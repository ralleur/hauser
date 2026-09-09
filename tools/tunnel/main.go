// hauser-tunnel — Fernzugriff für das Hauser-Add-on (Plan 21, Stufe 2).
//
// Ein tsnet-Knoten im Userspace (kein TUN, keine Rechte) hängt sich in das
// Tailnet des Haushalts und veröffentlicht Hauser über Tailscale Funnel als
// https://<hostname>.<tailnet>.ts.net. Jede weitergereichte Anfrage trägt
// `X-Hauser-Remote: 1`; der Node-Server verlangt dann den Gerätetoken.
//
// Gesteuert wird der Sidecar über eine lokale Kontrollschnittstelle
// (HTTP auf 127.0.0.1): GET /status liefert Zustand, Login-URL und
// Funnel-Adresse; POST /reset löscht den Knoten-State für eine neue Anmeldung.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

type status struct {
	State     string `json:"state"`               // starting | needs-login | running | funnel-error | stopped
	AuthURL   string `json:"authUrl,omitempty"`   // Login-Link, solange needs-login
	Hostname  string `json:"hostname,omitempty"`  // MagicDNS-Name ohne Punkt
	URL       string `json:"url,omitempty"`       // https://… sobald Funnel steht
	Error     string `json:"error,omitempty"`
	Tailnet   string `json:"tailnet,omitempty"`
	StartedAt string `json:"startedAt"`
}

type tunnel struct {
	mu     sync.Mutex
	st     status
	srv    *tsnet.Server
	cancel context.CancelFunc
	dir    string
	host   string
	target *url.URL
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func (t *tunnel) set(update func(*status)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	update(&t.st)
}

func (t *tunnel) snapshot() status {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.st
}

// run hält den Knoten am Leben: anmelden, Funnel öffnen, weiterreichen.
func (t *tunnel) run(ctx context.Context) {
	t.srv = &tsnet.Server{
		Dir:      t.dir,
		Hostname: t.host,
		Logf:     func(string, ...any) {},
	}
	defer t.srv.Close()

	t.set(func(s *status) { s.State = "starting" })
	if err := t.srv.Start(); err != nil {
		t.set(func(s *status) { s.State = "stopped"; s.Error = err.Error() })
		return
	}
	lc, err := t.srv.LocalClient()
	if err != nil {
		t.set(func(s *status) { s.State = "stopped"; s.Error = err.Error() })
		return
	}

	// Anmeldung abwarten: tsnet meldet die Login-URL über den Status.
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
		st, err := lc.Status(ctx)
		if err != nil {
			continue
		}
		switch st.BackendState {
		case "NeedsLogin":
			t.set(func(s *status) { s.State = "needs-login"; s.AuthURL = st.AuthURL; s.Error = "" })
			continue
		case "Running":
		default:
			continue
		}
		host := strings.TrimSuffix(st.Self.DNSName, ".")
		t.set(func(s *status) {
			s.AuthURL = ""
			s.Hostname = host
			s.Tailnet = st.CurrentTailnet.Name
		})
		break
	}

	proxy := httputil.NewSingleHostReverseProxy(t.target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Set("X-Hauser-Remote", "1")
		if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
			r.Header.Set("X-Forwarded-For", ip)
		}
		r.Host = t.target.Host
	}

	// Funnel braucht HTTPS-Zertifikate und die Freigabe im Tailnet; beides
	// ist eine Einmal-Bestätigung in der Tailscale-Konsole. Bis dahin bleibt
	// der Fehler sichtbar und der Versuch wiederholt sich.
	for {
		ln, err := t.srv.ListenFunnel("tcp", ":443")
		if err != nil {
			t.set(func(s *status) { s.State = "funnel-error"; s.Error = err.Error() })
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
			}
			continue
		}
		t.set(func(s *status) {
			s.State = "running"
			s.Error = ""
			s.URL = "https://" + s.Hostname
		})
		httpSrv := &http.Server{Handler: proxy, ReadHeaderTimeout: 15 * time.Second}
		go func() {
			<-ctx.Done()
			_ = httpSrv.Close()
		}()
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.set(func(s *status) { s.State = "funnel-error"; s.Error = err.Error() })
			continue
		}
		return
	}
}

func (t *tunnel) reset() {
	if t.cancel != nil {
		t.cancel()
	}
	if t.srv != nil {
		_ = t.srv.Close()
	}
	_ = os.RemoveAll(t.dir)
	_ = os.MkdirAll(t.dir, 0o700)
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	t.set(func(s *status) { *s = status{State: "starting", StartedAt: time.Now().UTC().Format(time.RFC3339)} })
	go t.run(ctx)
}

func main() {
	target, err := url.Parse(env("HAUSER_TUNNEL_TARGET", "http://127.0.0.1:4173"))
	if err != nil {
		log.Fatalf("ungültiges Ziel: %v", err)
	}
	dir := env("HAUSER_TUNNEL_STATE", filepath.Join(os.TempDir(), "hauser-tunnel"))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Fatalf("State-Verzeichnis: %v", err)
	}
	t := &tunnel{dir: dir, host: env("HAUSER_TUNNEL_HOSTNAME", "hauser"), target: target}
	t.st = status{State: "starting", StartedAt: time.Now().UTC().Format(time.RFC3339)}
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	go t.run(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(t.snapshot())
	})
	mux.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		t.reset()
		w.WriteHeader(http.StatusNoContent)
	})
	control := env("HAUSER_TUNNEL_CONTROL", "127.0.0.1:4174")
	log.Printf("hauser-tunnel: Kontrolle auf %s, Ziel %s, State %s", control, target, dir)
	log.Fatal(http.ListenAndServe(control, mux))
}
