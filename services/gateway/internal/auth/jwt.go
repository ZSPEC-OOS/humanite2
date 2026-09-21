package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT payload fields we care about.
type Claims struct {
	Sub    string   `json:"sub"`
	Tier   string   `json:"tier"`
	Scopes []string `json:"scopes"`
	Region string   `json:"region"`
	jwt.RegisteredClaims
}

// ParsePublicKey decodes a PEM-encoded RSA public key, handling literal \n from env vars.
func ParsePublicKey(pemStr string) (*rsa.PublicKey, error) {
	pemStr = strings.ReplaceAll(pemStr, `\n`, "\n")
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, errors.New("failed to decode PEM block — check JWT_PUBLIC_KEY format")
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaPub, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("not an RSA public key")
	}
	return rsaPub, nil
}

// ValidateJWT verifies the token signature and returns claims. Rejects non-RS256 algorithms.
func ValidateJWT(tokenStr string, pubKey *rsa.PublicKey) (*Claims, error) {
	token, err := jwt.ParseWithClaims(
		tokenStr,
		&Claims{},
		func(t *jwt.Token) (interface{}, error) {
			// Explicitly reject any algorithm that is not RS256
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, errors.New("unexpected signing method — only RS256 accepted")
			}
			return pubKey, nil
		},
		jwt.WithValidMethods([]string{"RS256"}),
	)
	if err != nil || !token.Valid {
		return nil, errors.New("invalid or expired token")
	}
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, errors.New("invalid claims structure")
	}
	return claims, nil
}
