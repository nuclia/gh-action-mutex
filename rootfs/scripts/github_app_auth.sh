#!/bin/bash

# GitHub App authentication helpers.
# TOKEN_FILE is defined in utils.sh which must be sourced before this file.

REFRESH_PID_FILE="/tmp/github_app_refresh.pid"
INSTALLATION_ID_FILE="/tmp/github_app_installation_id"
TOKEN_REFRESH_INTERVAL=2700 # 45 minutes

# Base64url encode from stdin
_base64url_encode() {
	openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Derive the GitHub API base URL from ARG_GITHUB_SERVER
_get_github_api_url() {
	if [ "$ARG_GITHUB_SERVER" = "github.com" ]; then
		echo "https://api.github.com"
	else
		echo "https://$ARG_GITHUB_SERVER/api/v3"
	fi
}

# Generate a JWT for GitHub App authentication
# args:
#   $1: app_id
#   $2: private_key (PEM content)
generate_jwt() {
	local app_id="$1"
	local private_key="$2"

	local now=$(date +%s)
	local iat=$((now - 60))
	local exp=$((now + 600))

	local header='{"alg":"RS256","typ":"JWT"}'
	local payload="{\"iat\":${iat},\"exp\":${exp},\"iss\":\"${app_id}\"}"

	local header_b64=$(echo -n "$header" | _base64url_encode)
	local payload_b64=$(echo -n "$payload" | _base64url_encode)

	local unsigned_token="${header_b64}.${payload_b64}"

	local signature=$(echo -n "$unsigned_token" | \
		openssl dgst -sha256 -sign <(echo "$private_key") -binary | \
		_base64url_encode)

	echo "${unsigned_token}.${signature}"
}

# Get installation ID for the repository
# args:
#   $1: jwt
get_app_installation_id() {
	local jwt="$1"
	local api_url=$(_get_github_api_url)

	local response
	response=$(curl -sf \
		-H "Authorization: Bearer $jwt" \
		-H "Accept: application/vnd.github+json" \
		"${api_url}/repos/${ARG_REPOSITORY}/installation")

	local id
	id=$(echo "$response" | jq -r '.id')

	if [ -z "$id" ] || [ "$id" = "null" ]; then
		echo "::error::Failed to get installation ID for repository $ARG_REPOSITORY" >&2
		echo "::error::API response: $response" >&2
		return 1
	fi

	echo "$id"
}

# Get an installation access token
# args:
#   $1: jwt
#   $2: installation_id
get_app_installation_token() {
	local jwt="$1"
	local installation_id="$2"
	local api_url=$(_get_github_api_url)

	local response
	response=$(curl -sf -X POST \
		-H "Authorization: Bearer $jwt" \
		-H "Accept: application/vnd.github+json" \
		"${api_url}/app/installations/${installation_id}/access_tokens")

	local token
	token=$(echo "$response" | jq -r '.token')

	if [ -z "$token" ] || [ "$token" = "null" ]; then
		echo "::error::Failed to get installation access token" >&2
		echo "::error::API response: $response" >&2
		return 1
	fi

	echo "$token"
}

# Generate and store a fresh installation token.
# Prints the token to stdout.
refresh_app_token() {
	local jwt
	jwt=$(generate_jwt "$ARG_GITHUB_APP_ID" "$ARG_GITHUB_APP_PRIVATE_KEY")

	local installation_id="$ARG_GITHUB_APP_INSTALLATION_ID"
	if [ -z "$installation_id" ] && [ -f "$INSTALLATION_ID_FILE" ]; then
		installation_id=$(cat "$INSTALLATION_ID_FILE")
	fi
	if [ -z "$installation_id" ]; then
		installation_id=$(get_app_installation_id "$jwt")
		echo "$installation_id" > "$INSTALLATION_ID_FILE"
	fi

	local token
	token=$(get_app_installation_token "$jwt" "$installation_id")

	# Atomic write so concurrent readers never see a partial token
	echo "$token" > "${TOKEN_FILE}.tmp"
	mv "${TOKEN_FILE}.tmp" "$TOKEN_FILE"

	echo "$token"
}

# Start a background process that refreshes the token periodically
start_token_refresh_daemon() {
	(
		while true; do
			sleep $TOKEN_REFRESH_INTERVAL
			echo "[github-app-auth] Refreshing token..."
			if refresh_app_token > /dev/null 2>&1; then
				echo "[github-app-auth] Token refreshed successfully"
			else
				echo "::warning::[github-app-auth] Token refresh failed, will retry next cycle"
			fi
		done
	) &
	echo $! > "$REFRESH_PID_FILE"
	echo "[github-app-auth] Token refresh daemon started (PID: $!, interval: ${TOKEN_REFRESH_INTERVAL}s)"
}

# Stop the background refresh process
stop_token_refresh_daemon() {
	if [ -f "$REFRESH_PID_FILE" ]; then
		local pid
		pid=$(cat "$REFRESH_PID_FILE")
		kill "$pid" 2>/dev/null || true
		rm -f "$REFRESH_PID_FILE"
	fi
}

# Initialize GitHub App authentication.
# Generates an initial token, overrides ARG_REPO_TOKEN, and starts
# the background refresh daemon.
init_github_app_auth() {
	echo "[github-app-auth] Initializing GitHub App authentication (App ID: $ARG_GITHUB_APP_ID)"

	local token
	token=$(refresh_app_token)

	# Override the repo token so the rest of the script uses it
	export ARG_REPO_TOKEN="$token"

	# Mask the token in GitHub Actions logs
	echo "::add-mask::$token"

	start_token_refresh_daemon

	# Clean up on exit
	trap stop_token_refresh_daemon EXIT

	echo "[github-app-auth] Authentication initialized successfully"
}
