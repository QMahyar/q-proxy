# E6 — Router early-exit for settings-free paths
Type: task (AFK) · Phase: Efficiency

## Question
robots/camouflage/static responses skip `loadSettings` entirely (load after early returns).

## Answer

DONE — OPTIONS + GET /robots.txt answered before loadSettings; handleRobots() now plain function.
