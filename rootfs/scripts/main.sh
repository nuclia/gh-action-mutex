#!/bin/bash -e

if [ $ARG_DEBUG != "false" ]; then
	set -x
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

source "$SCRIPT_DIR/utils.sh"

# Determine operation: use $1 if provided, otherwise use $ARG_OPERATION
OPERATION=${1:-$ARG_OPERATION}

echo "Cloning and checking out $ARG_REPOSITORY:$ARG_BRANCH in $ARG_CHECKOUT_LOCATION"

mkdir -p "$ARG_CHECKOUT_LOCATION"
cd "$ARG_CHECKOUT_LOCATION"

__mutex_queue_file=mutex_queue
__repo_url="https://x-access-token:$ARG_REPO_TOKEN@$ARG_GITHUB_SERVER/$ARG_REPOSITORY"

set_up_repo "$__repo_url"

if [ "$OPERATION" == "lock" ]; then
  __ticket_id="$GITHUB_RUN_ID-$ARG_MUTEX_KEY-$ARG_TICKET_ID_SUFFIX"
  echo "ticket_id=$__ticket_id" >> $GITHUB_STATE
  enqueue $ARG_BRANCH $__mutex_queue_file $__ticket_id
  wait_for_lock $ARG_BRANCH $__mutex_queue_file $__ticket_id
  echo "Lock successfully acquired"

elif [ "$OPERATION" == "unlock" ]; then
  
  if [ "$ARG_POST_EXECUTION" == "true" ]; then
    __ticket_id="$STATE_ticket_id"
  else
    __ticket_id="$GITHUB_RUN_ID-$ARG_MUTEX_KEY-$ARG_TICKET_ID_SUFFIX"
  fi
  
  dequeue $ARG_BRANCH $__mutex_queue_file $__ticket_id
  echo "Successfully unlocked"

else
  echo "Invalid operation: $OPERATION. Must be 'lock' or 'unlock'."
  exit 1
fi
