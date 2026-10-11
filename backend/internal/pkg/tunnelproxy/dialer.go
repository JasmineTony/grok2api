package tunnelproxy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/Asutorufa/yuhaiin/pkg/net/netapi"
	"github.com/Asutorufa/yuhaiin/pkg/net/proxy/trojan"
	"github.com/Asutorufa/yuhaiin/pkg/net/proxy/vmess"
	"github.com/Asutorufa/yuhaiin/pkg/protos/node/protocol"
	sscore "github.com/shadowsocks/go-shadowsocks2/core"
	"github.com/shadowsocks/go-shadowsocks2/socks"
)

type Dialer struct {
	proxy             netapi.Proxy
	shadowsocksCipher sscore.StreamConnCipher
	server            string
}

func NewDialer(value string) (*Dialer, error) {
	config, err := Parse(value)
	if err != nil {
		return nil, err
	}
	if config.Scheme == "ss" {
		cipher, err := sscore.PickCipher(config.Method, nil, config.Credential)
		if err != nil {
			return nil, err
		}
		return &Dialer{shadowsocksCipher: cipher, server: config.Server}, nil
	}
	proxy, err := buildProxy(config)
	if err != nil {
		return nil, err
	}
	return &Dialer{proxy: proxy}, nil
}

func (d *Dialer) Dial(network, address string) (net.Conn, error) {
	return d.DialContext(context.Background(), network, address)
}

func (d *Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if d == nil || (d.proxy == nil && d.shadowsocksCipher == nil) {
		return nil, errors.New("隧道代理拨号器未初始化")
	}
	if !strings.HasPrefix(network, "tcp") {
		return nil, fmt.Errorf("隧道代理不支持网络 %q", network)
	}
	if d.shadowsocksCipher != nil {
		return d.dialShadowsocks(ctx, address)
	}
	target, err := netapi.ParseAddress(network, address)
	if err != nil {
		return nil, err
	}
	return d.proxy.Conn(ctx, target)
}

func (d *Dialer) dialShadowsocks(ctx context.Context, address string) (net.Conn, error) {
	target := socks.ParseAddr(address)
	if target == nil {
		return nil, errors.New("Shadowsocks 目标地址无效")
	}
	connection, err := newServerNetDialer().DialContext(ctx, "tcp", d.server)
	if err != nil {
		return nil, err
	}
	connection = d.shadowsocksCipher.StreamConn(connection)
	if _, err := connection.Write(target); err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("写入 Shadowsocks 目标地址: %w", err)
	}
	return connection, nil
}

func validateConfig(config Config) error {
	if config.Scheme == "ss" {
		_, err := sscore.PickCipher(config.Method, nil, config.Credential)
		return err
	}
	_, err := buildProxy(config)
	return err
}

func buildProxy(config Config) (netapi.Proxy, error) {
	var current netapi.Proxy = &serverDialer{address: config.Server}
	if config.Transport == "ws" {
		current = &websocketProxy{config: config, dialer: current}
	} else if config.Security == "reality" {
		var err error
		current, err = newRealityProxy(config, current)
		if err != nil {
			return nil, fmt.Errorf("创建 Reality 客户端: %w", err)
		}
	} else if config.TLS {
		current = &tlsProxy{config: config, dialer: current}
	}
	switch config.Scheme {
	case "trojan":
		protocolConfig := &protocol.Trojan{}
		protocolConfig.SetPassword(config.Credential)
		return trojan.NewClient(protocolConfig, current)
	case "vless":
		protocolConfig := &protocol.Vless{}
		protocolConfig.SetUuid(config.Credential)
		return newOwnedVLESSProxy(protocolConfig, current, config.Flow)
	case "vmess":
		protocolConfig := &protocol.Vmess{}
		protocolConfig.SetUuid(config.Credential)
		protocolConfig.SetAlterId(strconv.Itoa(config.AlterID))
		protocolConfig.SetSecurity(config.Cipher)
		return vmess.NewClient(protocolConfig, current)
	default:
		return nil, errors.New("不支持的隧道代理协议")
	}
}
