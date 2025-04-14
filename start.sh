#!/bin/bash

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

clear
echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      ${BLUE}Choose the target language  ${NC}      ${BOLD}║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"
echo ""

languages=(
  "swedish"
  "korean"
  "ukrainian"
  "greek"
  "japanese"
  "english"
  "american english"
  "russian"
  "hindi"
  "german"
  "danish"
  "bulgarian"
  "czech"
  "polish"
  "slovak"
  "finnish"
  "spanish"
  "croatian"
  "dutch"
  "portuguese"
  "french"
  "malay"
  "italian"
  "romanian"
  "mandarin"
  "tamil"
  "turkish"
  "indonesian"
  "tagalog"
  "arabic"
  "norwegian"
  "vietnamese"
  "hungarian"
  "british english"
  "french canadian"
)

echo -e "${BOLD}Available languages:${NC}\n"

COLUMNS=3
count=${#languages[@]}
rows=$(( (count + COLUMNS - 1) / COLUMNS ))

for (( i=0; i<rows; i++ )); do
  for (( j=0; j<COLUMNS; j++ )); do
    index=$((i + j*rows))
    if [ $index -lt $count ]; then
      printf "${GREEN}%2d)${NC} %-20s" $((index+1)) "${languages[$index]}"
    fi
  done
  echo ""
done

echo ""

valid_selection=false
while [ "$valid_selection" = false ]; do
  read -p "$(echo -e "${YELLOW}Enter a language number (1-$count) or type the language name [Default: english]:${NC} ")" selection
  
  if [ -z "$selection" ]; then
    selection="english"
  fi

  is_valid=false

  if [[ $selection =~ ^[0-9]+$ ]] && [ $selection -ge 1 ] && [ $selection -le $count ]; then
    selected_language=${languages[$((selection-1))]}
    is_valid=true
  else
    selection_lower=$(echo "$selection" | tr '[:upper:]' '[:lower:]')
    for lang in "${languages[@]}"; do
      if [ "$selection_lower" = "$(echo "$lang" | tr '[:upper:]' '[:lower:]')" ]; then
        selected_language=$lang
        is_valid=true
        break
      fi
    done
  fi

  if [ "$is_valid" = true ]; then
    export TARGET_LANGUAGE="$selected_language"
    echo -e "\n${BOLD}Selected language: ${BLUE}$selected_language${NC}${BOLD}.${NC}"
    valid_selection=true
  else
    echo -e "\n${BOLD}Error: '${YELLOW}$selection${NC}${BOLD}' is not a valid language option. Please try again.${NC}\n"
  fi
done

echo -e "\n${BOLD}Starting translation...${NC}\n"

valid_speakers=false
while [ "$valid_speakers" = false ]; do
  echo -e "\n${BOLD}Note:${NC} It is recommended to specify the exact number of speakers for better results."
  read -p "$(echo -e "${YELLOW}How many speakers are in the video? (auto-detect or 1-10) [Default: auto-detect]:${NC} ")" num_speakers
  
  if [ -z "$num_speakers" ]; then
    num_speakers="auto-detect"
  fi

  if [ "$num_speakers" = "auto-detect" ]; then
    valid_speakers=true
  elif [[ $num_speakers =~ ^[0-9]+$ ]] && [ $num_speakers -ge 1 ] && [ $num_speakers -le 10 ]; then
    valid_speakers=true
  else
    echo -e "\n${BOLD}Error: '${YELLOW}$num_speakers${NC}${BOLD}' is not valid. Enter 'auto-detect' or a number between 1-10.${NC}\n"
  fi
done

export NUM_SPEAKERS="$num_speakers"
echo -e "\n${BOLD}Number of speakers: ${BLUE}$num_speakers${NC}${BOLD}.${NC}"

valid_lipsync=false
while [ "$valid_lipsync" = false ]; do
  echo -e "\n${BOLD}Note:${NC} Lipsync duration depends on your sync.so subscription (1-30 minutes)."
  echo -e "${BOLD}Currently supports only one face. Please verify your subscription limits before proceeding.${NC}"
  read -p "$(echo -e "${YELLOW}Do you want to apply lipsync? (yes/no) [Default: no]:${NC} ")" lipsync_option
  
  if [ -z "$lipsync_option" ]; then
    lipsync_option="no"
  fi

  lipsync_lower=$(echo "$lipsync_option" | tr '[:upper:]' '[:lower:]')
  
  if [ "$lipsync_lower" = "yes" ] || [ "$lipsync_lower" = "no" ]; then
    valid_lipsync=true
  else
    echo -e "\n${BOLD}Error: Please enter 'yes' or 'no'.${NC}\n"
  fi
done

export APPLY_LIPSYNC="$lipsync_lower"
echo -e "\n${BOLD}Apply lipsync: ${BLUE}$lipsync_lower${NC}${BOLD}.${NC}\n"

valid_debug=false
while [ "$valid_debug" = false ]; do
  read -p "$(echo -e "${YELLOW}Activate debug mode to see all logs? (yes/no) [Default: yes]:${NC} ")" debug_option
  
  if [ -z "$debug_option" ]; then
    debug_option="yes"
  fi

  debug_lower=$(echo "$debug_option" | tr '[:upper:]' '[:lower:]')
  
  if [ "$debug_lower" = "yes" ] || [ "$debug_lower" = "no" ]; then
    valid_debug=true
  else
    echo -e "\n${BOLD}Error: Please enter 'yes' or 'no'.${NC}\n"
  fi
done

export DEBUG_MODE="$debug_lower"
echo -e "\n${BOLD}Debug mode: ${BLUE}$debug_lower${NC}${BOLD}.${NC}\n"

valid_subtitle=false
while [ "$valid_subtitle" = false ]; do
  read -p "$(echo -e "${YELLOW}Do you want to activate subtitles? (yes/no) [Default: yes]:${NC} ")" subtitle_option
  
  if [ -z "$subtitle_option" ]; then
    subtitle_option="yes"
  fi

  subtitle_lower=$(echo "$subtitle_option" | tr '[:upper:]' '[:lower:]')
  
  if [ "$subtitle_lower" = "yes" ] || [ "$subtitle_lower" = "no" ]; then
    valid_subtitle=true
  else
    echo -e "\n${BOLD}Error: Please enter 'yes' or 'no'.${NC}\n"
  fi
done

export ACTIVATE_SUBTITLE="$subtitle_lower"
echo -e "\n${BOLD}Activate subtitles: ${BLUE}$subtitle_lower${NC}${BOLD}.${NC}\n"

bun src/core/index.ts 