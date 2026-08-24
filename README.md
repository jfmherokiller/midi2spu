# midi2spu

i dont know how to format these readmes but here goes:

this is my midi2spu project it takes a midifile and converts it into a correctly formatted spu text file for the zspu in garrysmod. 
As of right now its pretty stupid because it pretty much dumps the midi notes into the spu file.

if you want to try it out in its current form look here

https://jfmherokiller.github.io/midi2spu/

## building it yourself

it's a Vite + TypeScript project, no backend needed:

```
npm install
npm run dev       # dev server with hot reload
npm run build     # production build, output goes to dist/
npm run preview   # serve the dist/ build locally
```

pushes to master auto-deploy to the github pages link above via `.github/workflows/deploy-pages.yml`.
