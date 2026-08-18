package security

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
)

func TestCipherRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	cipher, err := NewCipher(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.Encrypt("refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	if encrypted == "refresh-secret" {
		t.Fatal("密文不应等于明文")
	}
	plain, err := cipher.Decrypt(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "refresh-secret" {
		t.Fatalf("解密结果 = %q", plain)
	}
}

func TestCipherDecryptClassifiesWrongKey(t *testing.T) {
	firstKey := make([]byte, 32)
	secondKey := make([]byte, 32)
	if _, err := rand.Read(firstKey); err != nil {
		t.Fatal(err)
	}
	if _, err := rand.Read(secondKey); err != nil {
		t.Fatal(err)
	}
	first, err := NewCipher(base64.StdEncoding.EncodeToString(firstKey))
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewCipher(base64.StdEncoding.EncodeToString(secondKey))
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := first.Encrypt("stored-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := second.Decrypt(encrypted); !errors.Is(err, ErrCredentialDecrypt) {
		t.Fatalf("wrong-key error = %v, want ErrCredentialDecrypt", err)
	}
}
