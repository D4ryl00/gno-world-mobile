import { Config } from '@remotion/cli/config';

// capture/, voice/ and brand/ files are served from out/ (staticFile('capture/sim.mp4'), …)
Config.setPublicDir('./out');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
