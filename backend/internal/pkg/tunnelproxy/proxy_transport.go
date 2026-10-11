package tunnelproxy

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Asutorufa/yuhaiin/pkg/net/netapi"
	"github.com/coder/websocket"
)

const tunnelHandshakeTimeout = 10 * time.Second

type tlsProxy struct {
	netapi.EmptyDispatch
	config Config
	dialer netapi.Proxy
}

func (p *tlsProxy) Conn(ctx context.Context, address netapi.Address) (net.Conn, error) {
	connection, err := p.dialer.Conn(ctx, address)
	if err != nil {
		return nil, err
	}
	tlsConnection := tls.Client(connection, p.tlsConfig())
	handshakeCtx, cancel := newTunnelHandshakeContext(ctx)
	defer cancel()
	if err := tlsConnection.HandshakeContext(handshakeCtx); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("隧道 TLS 握手: %w", err)
	}
	return tlsConnection, nil
}

func (p *tlsProxy) PacketConn(context.Context, netapi.Address) (net.PacketConn, error) {
	return nil, errors.New("TLS 隧道不支持 UDP")
}

func (p *tlsProxy) tlsConfig() *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS12, ServerName: p.config.ServerName,
		InsecureSkipVerify: p.config.Insecure, NextProtos: append([]string(nil), p.config.ALPN...),
	}
}

type websocketProxy struct {
	netapi.EmptyDispatch
	config Config
	dialer netapi.Proxy
}

func (p *websocketProxy) Conn(ctx context.Context, address netapi.Address) (net.Conn, error) {
	scheme := "ws"
	if p.config.TLS {
		scheme = "wss"
	}
	path, rawQuery, _ := strings.Cut(p.config.WebSocketPath, "?")
	endpoint := (&url.URL{Scheme: scheme, Host: p.config.WebSocketHost, Path: path, RawQuery: rawQuery}).String()
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, _, _ string) (net.Conn, error) {
			return p.dialer.Conn(dialCtx, address)
		},
		ForceAttemptHTTP2: false,
		TLSClientConfig:   websocketTLSConfig(p.config),
	}
	handshakeCtx, cancel := newTunnelHandshakeContext(ctx)
	defer cancel()
	connection, _, err := websocket.Dial(handshakeCtx, endpoint, &websocket.DialOptions{
		HTTPClient: &http.Client{Transport: transport},
		Host:       p.config.WebSocketHost,
	})
	if err != nil {
		transport.CloseIdleConnections()
		return nil, fmt.Errorf("隧道 WebSocket 握手: %w", err)
	}
	return websocket.NetConn(context.Background(), connection, websocket.MessageBinary), nil
}

func (p *websocketProxy) PacketConn(context.Context, netapi.Address) (net.PacketConn, error) {
	return nil, errors.New("WebSocket 隧道不支持 UDP")
}

type serverDialer struct {
	netapi.EmptyDispatch
	address string
}

func (d *serverDialer) Conn(ctx context.Context, _ netapi.Address) (net.Conn, error) {
	return newServerNetDialer().DialContext(ctx, "tcp", d.address)
}

func newServerNetDialer() *net.Dialer {
	return &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
}

func newTunnelHandshakeContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, tunnelHandshakeTimeout)
}

func websocketTLSConfig(config Config) *tls.Config {
	tlsConfig := (&tlsProxy{config: config}).tlsConfig()
	tlsConfig.NextProtos = []string{"http/1.1"}
	return tlsConfig
}

func (d *serverDialer) PacketConn(context.Context, netapi.Address) (net.PacketConn, error) {
	return nil, errors.New("当前隧道代理不支持 UDP")
}
