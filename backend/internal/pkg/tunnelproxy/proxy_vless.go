package tunnelproxy

import (
	"context"
	"errors"
	"fmt"
	"net"

	"github.com/Asutorufa/yuhaiin/pkg/net/netapi"
	visionproxy "github.com/Asutorufa/yuhaiin/pkg/net/proxy/vision"
	yuhaiinvless "github.com/Asutorufa/yuhaiin/pkg/net/proxy/vless"
	"github.com/Asutorufa/yuhaiin/pkg/protos/node/protocol"
	"github.com/google/uuid"
	singvmess "github.com/metacubex/sing-vmess"
	singvless "github.com/metacubex/sing-vmess/vless"
	singmetadata "github.com/metacubex/sing/common/metadata"
)

// ownedVLESSProxy closes the transport connection when the upstream VLESS
// client fails while writing its initial request. yuhaiin's VLESS client does
// not transfer the failed connection back to its caller, so ownership must be
// retained at this boundary to prevent failed retries from leaking sockets.
type ownedVLESSProxy struct {
	netapi.EmptyDispatch
	config *protocol.Vless
	dialer netapi.Proxy
	flow   string
	uuid   [16]byte
}

func newOwnedVLESSProxy(config *protocol.Vless, dialer netapi.Proxy, flow string) (netapi.Proxy, error) {
	if _, err := yuhaiinvless.NewClient(config, dialer); err != nil {
		return nil, err
	}
	proxy := &ownedVLESSProxy{config: config, dialer: dialer, flow: flow}
	if flow == "xtls-rprx-vision" {
		userID, err := uuid.Parse(config.GetUuid())
		if err != nil {
			return nil, errors.New("VLESS Vision UUID 无效")
		}
		copy(proxy.uuid[:], userID[:])
	}
	return proxy, nil
}

func (p *ownedVLESSProxy) Conn(ctx context.Context, address netapi.Address) (net.Conn, error) {
	connection, err := p.dialer.Conn(ctx, address)
	if err != nil {
		return nil, err
	}
	if p.flow == "xtls-rprx-vision" {
		result, requestErr := newVisionVLESSConn(connection, address, p.uuid, p.flow)
		if requestErr != nil {
			_ = connection.Close()
			return nil, fmt.Errorf("发送 VLESS Vision 请求: %w", requestErr)
		}
		visionConnection, visionErr := visionproxy.NewVisionConn(result, connection, p.uuid)
		if visionErr != nil {
			_ = result.Close()
			return nil, fmt.Errorf("创建 VLESS Vision 连接: %w", visionErr)
		}
		return visionConnection, nil
	}
	client, err := yuhaiinvless.NewClient(p.config, &singleConnectionProxy{connection: connection})
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	result, err := client.Conn(ctx, address)
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return result, nil
}

func newVisionVLESSConn(connection net.Conn, address netapi.Address, userID [16]byte, flow string) (net.Conn, error) {
	destination := singmetadata.ParseSocksaddrHostPort(address.Hostname(), address.Port())
	result := singvless.NewConn(connection, userID, singvmess.CommandTCP, destination, flow)
	if _, err := result.Write(nil); err != nil {
		return nil, err
	}
	return result, nil
}

func (p *ownedVLESSProxy) PacketConn(ctx context.Context, address netapi.Address) (net.PacketConn, error) {
	return nil, errors.New("VLESS 隧道不支持 UDP")
}

type singleConnectionProxy struct {
	netapi.EmptyDispatch
	connection net.Conn
}

func (p *singleConnectionProxy) Conn(context.Context, netapi.Address) (net.Conn, error) {
	if p.connection == nil {
		return nil, errors.New("VLESS 底层连接不可用")
	}
	connection := p.connection
	p.connection = nil
	return connection, nil
}

func (p *singleConnectionProxy) PacketConn(context.Context, netapi.Address) (net.PacketConn, error) {
	return nil, errors.New("VLESS 隧道不支持 UDP")
}
