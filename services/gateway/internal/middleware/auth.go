package middleware

import (
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"strings"

	"humanite/gateway/internal/auth"
)

// publicPaths are routes that do NOT require a JWT.
var publicPaths = map[string]bool{
	"/v1/health":         true,
	"/v1/auth/login":     true,
	"/v1/auth/register":  true,
	"/v1/auth/refresh":   true,
}

// Auth wraps a handler with JWT validation middleware.
func Auth(pubKey *rsa.PublicKey) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if publicPaths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}

			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				writeJSONError(w, http.StatusUnauthorized,
					"AUTHENTICATION_REQUIRED", "Authorization header with Bearer token required.")
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := auth.ValidateJWT(tokenStr, pubKey)
			if err != nil {
				writeJSONError(w, http.StatusUnauthorized,
					"TOKEN_INVALID", "Token is invalid or expired.")
				return
			}

			// Inject verified claims as internal headers for downstream services
			r.Header.Set("X-User-ID", claims.Sub)
			r.Header.Set("X-User-Tier", claims.Tier)
			r.Header.Set("X-User-Region", claims.Region)
			// Strip the original Authorization header from internal traffic
			r.Header.Del("Authorization")

			next.ServeHTTP(w, r)
		})
	}
}

func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}
