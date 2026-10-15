#first manually update package.json version

VERSION=$(node -p "require('./package.json').version")
ANDROID_HOME=~/Android/sdk
# perl -pi is used instead of sed -i / grep -P so this works on both macOS and Linux
perl -pi -e "s/versionName \".*\"/versionName \"$VERSION\"/" android/app/build.gradle

# Increment versionCode
perl -pi -e 's/(versionCode )(\d+)/$1.($2+1)/e' android/app/build.gradle

# update Info.plist version
perl -0pi -e 's/(<key>CFBundleVersion<\/key>\s*<string>)(\d+)/$1.($2+1)/e' ios/App/App/Info.plist
perl -0pi -e "s/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*/\$1$VERSION/" ios/App/App/Info.plist

npm run build
npx cap sync android
npx cap sync ios

#build android release apk
cd android
./gradlew assembleRelease
./gradlew bundleRelease  #WIP signing not working yet...still gotta open Android Studio
cd ..