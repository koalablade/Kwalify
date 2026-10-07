KWALIFY - LOCAL CONTROLS
========================

  START.bat   Double-click to run Kwalify.
              A "Kwalify server" window opens and shows what is happening.
              When it says "Kwalify is running", open the address it shows
              (http://localhost:<PORT>, normally http://localhost:5000).
              Keep that window open while you use Kwalify.

  STOP.bat    Double-click to stop Kwalify cleanly.
              (Ctrl+C in the "Kwalify server" window does the same.)

Kwalify is completely OFF until you double-click START.bat.
Nothing in this folder starts on its own, at boot, or at login.


GOOD TO KNOW
------------
  * PostgreSQL must already be running. START checks it and, if it is not,
    tells you how to start it. START/STOP never start, stop or change your
    database.
  * START will not start a second copy. If Kwalify is already running it
    just tells you.
  * STOP only stops the Kwalify server. If Kwalify is not running it just
    tells you. It never stops other programs.
  * Your settings come from the .env file in the main Kwalify folder.
  * START does not start the Cloudflare tunnel, so the public kwalify.net
    address will not work - only http://localhost on this PC.


ONE-TIME: TURN-OFF-AUTOSTART.bat
--------------------------------
Older Kwalify setup scripts could register Windows tasks that run Kwalify on
their own (start at login, check every 5 minutes, weekly maintenance, nightly
database backup) plus a background "health watch" that restarts the server.
If START.bat ever prints "Windows still has Kwalify tasks", double-click
TURN-OFF-AUTOSTART.bat once to remove them. If it says access was denied,
right-click it and choose "Run as administrator".
It does not touch PostgreSQL or your data. Nightly automatic backups stop;
run a backup yourself when you want one.
