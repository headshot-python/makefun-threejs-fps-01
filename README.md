# makefun-threejs-fps-01

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/headshot-python/makefun-threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/headshot-python/makefun-threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Kestrel Yard — an original container-yard tactical FPS built with three.js 0.187.0 for the make.fun threejs-fps-02 bounty.

Round-based Counter-Strike-style play: 3v3 (player + 2 bots vs 3 bots), buy phase with money earned each round, five weapons (pistol, SMG, rifle, shotgun, sniper) plus HE and smoke grenades, bomb plant/defuse objective at two sites, and bot AI that follows routes, holds positions, and reacts to sight and sound.

## Run it

```sh
python3 -m http.server 8000 --directory game
```

Then open http://localhost:8000/ in desktop Chrome. No build step, no network requests — three.js is vendored under `game/vendor/three/`.

## License

MIT — see LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tt8kqvqf&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
