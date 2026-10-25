pnpm version minor
ng build --base-href /kalimbaka/ 
rm -rf ./docs
mv ./dist/kalimbapp/browser   ./docs
rm -rf ./dist
#./addAndPushUI.sh



