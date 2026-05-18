TOKEN_FILE="/tmp/github_app_token"

# Get the current authentication token.
# Reads from the token file (refreshed by the app auth daemon) if present,
# otherwise falls back to the static ARG_REPO_TOKEN.
get_current_token() {
	if [ -f "$TOKEN_FILE" ]; then
		cat "$TOKEN_FILE"
	else
		echo "$ARG_REPO_TOKEN"
	fi
}

# Update the git remote URL with the latest token.
refresh_remote_url() {
	local token
	token=$(get_current_token)
	git remote set-url origin "https://x-access-token:${token}@${ARG_GITHUB_SERVER}/${ARG_REPOSITORY}"
}

# Set up the mutex repo
# args:
#   $1: repo_url
set_up_repo() {
	__repo_url=$1

	git init --quiet
	git config --local user.name "github-bot" --quiet
	git config --local user.email "github-bot@users.noreply.github.com" --quiet
	git remote remove origin 2>/dev/null || true
	git remote add origin "$__repo_url"
}

# Update the branch to the latest from the remote. Or checkout to an orphan branch
# args:
#   $1: branch
update_branch() {
	__branch=$1
	__retries=0

	while true; do
		git switch --orphan gh-action-mutex/temp-branch-$(date +%s) --quiet
		git branch -D $__branch --quiet 2>/dev/null || true
		if git fetch origin $__branch --quiet 2>/dev/null; then
			break
		fi
		__retries=$(($__retries + 1))
		if [ $__retries -ge 20 ]; then
			echo "Error: failed to fetch branch $__branch after 20 retries, giving up"
			exit 1
		fi
		echo "Warning: failed to fetch branch $__branch from remote, retrying in 5s... (attempt $__retries/20)"
		sleep 5
	done
	git checkout $__branch --quiet || git switch --orphan $__branch --quiet
}

# Add to the queue
# args:
#   $1: branch
#   $2: queue_file
#   $3: ticket_id
enqueue() {
	__branch=$1
	__queue_file=$2
	__ticket_id=$3

	__has_error=0

	echo "[$__ticket_id] Enqueuing to branch $__branch, file $__queue_file"

	update_branch $__branch

	touch $__queue_file

	# if we are not in the queue, add ourself to the queue
	if ! grep -qx "$__ticket_id" "$__queue_file" ; then
		echo "[$__ticket_id] Adding ourself to the queue file $__queue_file"
		echo "$__ticket_id" >> "$__queue_file"

		git add $__queue_file
		git commit -m "[$__ticket_id] Enqueue " --quiet

		set +e # allow errors
		refresh_remote_url
		git push --set-upstream origin $__branch --quiet
		__has_error=$((__has_error + $?))
		set -e
	fi

	if [ ! $__has_error -eq 0 ]; then
		sleep 1
		enqueue $@
	fi
}

# Wait for the lock to become available
# args:
#   $1: branch
#   $2: queue_file
#   $3: ticket_id
wait_for_lock() {
	__branch=$1
	__queue_file=$2
	__ticket_id=$3

	while true; do
		update_branch $__branch

		# if we are not the first in line, spin
		if [ -s $__queue_file ]; then
			cur_lock=$(head -n 1 $__queue_file)
			if [ "$cur_lock" != "$__ticket_id" ]; then
				echo "[$__ticket_id] Waiting for lock - Current lock assigned to [$cur_lock]"
				sleep 5
				continue
			fi
		else
			echo "[$__ticket_id] $__queue_file unexpectedly empty, continuing"
		fi
		break
	done
}
# Remove from the queue, when locked by it or just enqueued
# args:
#   $1: branch
#   $2: queue_file
#   $3: ticket_id
dequeue() {
	__branch=$1
	__queue_file=$2
	__ticket_id=$3

	__retries=0
	__max_retries=20

	while true; do
		update_branch $__branch

		if [[ "$(head -n 1 $__queue_file)" == "$__ticket_id" ]]; then
			echo "[$__ticket_id] Unlocking"
			__message="[$__ticket_id] Unlock"
			# Remove top line
			sed -i '1d' "$__queue_file"
		elif grep -qx "$__ticket_id" "$__queue_file" ; then
			echo "[$__ticket_id] Dequeueing. We don't have the lock!"
			__message="[$__ticket_id] Dequeue"
			# Remove the matching line
			sed -i "/^${__ticket_id}$/d" $__queue_file
		else
			1>&2 echo "[$__ticket_id] Not in queue! Mutex file:"
			cat $__queue_file
			exit 1
		fi

		git add $__queue_file
		git commit -m "$__message" --quiet

		set +e # allow errors
		git push --set-upstream origin $__branch --quiet
		__push_exit=$?
		set -e

		if [ $__push_exit -eq 0 ]; then
			break
		fi

		__retries=$(($__retries + 1))
		if [ $__retries -ge $__max_retries ]; then
			echo "Error: [$__ticket_id] failed to push dequeue after $__max_retries retries, giving up"
			exit 1
		fi
		__sleep_time=$(( __retries < 10 ? __retries : 10 ))
		echo "Warning: [$__ticket_id] push failed, retrying in ${__sleep_time}s... (attempt $__retries/$__max_retries)"
		sleep $__sleep_time
	done
}

