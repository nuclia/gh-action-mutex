#!/bin/bash -e
if [ $ARG_POST_EXECUTION != "true" ]; then
  echo "Skipping post job unlock operation as ARG_POST_EXECUTION is false."
  exit 0
else
  /scripts/main.sh unlock
fi