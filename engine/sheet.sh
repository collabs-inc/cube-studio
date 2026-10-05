#!/bin/bash
# sheet.sh outfile cols files... → contact sheet (each tile 480 wide, with a 4px gap)
out=$1; cols=$2; shift 2
tmp=$(mktemp -d); i=0; row=0; rowfiles=()
files=("$@")
for ((k=0; k<${#files[@]}; k+=cols)); do
  convert "${files[@]:k:cols}" -resize 480x -bordercolor '#222' -border 2 +append $tmp/row$(printf %03d $row).png
  row=$((row+1))
done
convert $tmp/row*.png -append "$out"
rm -rf $tmp
