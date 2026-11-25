# The terminal part of docs/assets/demo.gif. Remake the GIF with: bash docs/assets/demo.sh
# (it sets up a scratch home folder, a store and a stand-in host, then runs this tape).
Output "demo-terminal.mp4"

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 640
Set Padding 32
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type "cd $FORGE_DEMO_WORK && clear"
Enter
Show

Sleep 700ms
Type "forge publish report.html"
Sleep 300ms
Enter
Sleep 3s
Type "forge share report"
Sleep 300ms
Enter
Sleep 4.5s
Type "perl -pi -e 's/>14</>15</' report.html"
Sleep 300ms
Enter
Sleep 500ms
Type "forge publish report.html --live"
Sleep 300ms
Enter
Sleep 4.5s
