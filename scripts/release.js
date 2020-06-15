'use strict'
const exec = require('child_process').execSync

const TEST_BUILD = process.env.TEST_BUILD // set true if you would like to test on your local machine

// electron-builder security override.
// Need if wanna create test release build from PR
process.env.PUBLISH_FOR_PULL_REQUEST = TEST_BUILD

if (!process.env.CI && !TEST_BUILD) {
  console.error('Create release only on CI server')
  process.exit(1)
}

const githubRef = process.env.GITHUB_REF
const gitTag = getGithubTag()
const githubEventName = process.env.GITHUB_EVENT_NAME
const repoName = process.env.GITHUB_REPOSITORY

console.log({ gitTag, repoName, githubRef, githubEventName })

const isReleaseCommit = TEST_BUILD || gitTag && repoName === 'UltimateHackingKeyboard/electron-qa'

if (!isReleaseCommit) {
  console.log('It is not a release task. Skipping publish.')
  process.exit(0)
}

const path = require('path')
const builder = require('electron-builder')
const fs = require('fs-extra')
const { notarize } = require('electron-notarize')

const Platform = builder.Platform
const ELECTRON_BUILD_FOLDER = path.join(__dirname, '../tmp-build')

let target = ''
let artifactName = 'Electron-QA-${version}-${os}'

if (process.platform === 'darwin') {
  target = Platform.MAC.createTarget()
  artifactName += '.${ext}'
} else if (process.platform === 'win32') {
  target = Platform.WINDOWS.createTarget('nsis', builder.Arch.ia32, builder.Arch.x64)
  artifactName += '-${arch}.${ext}'
} else if (process.platform === 'linux') {
  target = Platform.LINUX.createTarget('AppImage')
  artifactName += '-${arch}.${ext}'
} else {
  console.error(`I dunno how to publish a release for ${process.platform} :(`)
  process.exit(1)
}

if (process.platform === 'darwin' && process.env.CI) {
  const encryptedFile = path.join(__dirname, './certs/mac-cert.p12.enc')
  const decryptedFile = path.join(__dirname, './certs/mac-cert.p12')
  exec(`openssl aes-256-cbc -K $CERT_KEY -iv $CERT_IV -in ${encryptedFile} -out ${decryptedFile} -d`)
} else if (process.platform === 'win32') {
  // decrypt windows certificate
  exec('openssl aes-256-cbc -K %CERT_KEY% -iv %CERT_IV% -in scripts/certs/windows-cert.p12.enc -out scripts/certs/windows-cert.p12 -d')
}

if (TEST_BUILD || gitTag) {
  prepareDistDir()

  builder.build({
    targets: target,
    config: {
      afterPack,
      afterSign,
      directories: {
        app: ELECTRON_BUILD_FOLDER
      },
      appId: 'com.ultimategadgetlabs.electron-qa',
      productName: 'Electron QA',
      mac: {
        category: 'public.app-category.utilities',
        identity: 'CMXCBCFHDG',
        cscLink: path.join(__dirname, 'certs/mac-cert.p12'),
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: path.join(__dirname, 'entitlements.mac.plist'),
        entitlementsInherit: path.join(__dirname, 'entitlements.mac.plist')
      },
      win: {
        publisherName: 'Ultimate Gadget Laboratories Kft.',
        certificateFile: path.join(__dirname, 'certs/windows-cert.p12')
      },
      linux: {},
      publish: 'github',
      artifactName,
      files: [
        '**/*'
      ]
    },
  })
    .then(() => {
      console.log('Packing success.')
    })
    .catch((error) => {
      console.error(`${error}`)
      process.exit(1)
    })
} else {
  console.log('No git tag')
  process.exit(1)
}

async function afterPack(context) {
  if (process.platform !== 'linux')
    return

  const sourceExecutable = path.join(context.appOutDir, 'electron-qa')
  const targetExecutable = path.join(context.appOutDir, 'electron-qa-ui')
  const launcherScript = path.join(__dirname, 'launcher-script.sh')
  const chromeSandbox = path.join(context.appOutDir, 'chrome-sandbox')

  await fs.rename(sourceExecutable, targetExecutable)
  await fs.copy(launcherScript, sourceExecutable)
  await fs.chmod(sourceExecutable, 0o755)

  // remove the chrome-sandbox file since we explicitly disable it
  await fs.unlink(chromeSandbox)
}

async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const appName = context.packager.appInfo.productFilename

  return await notarize({
    appBundleId: 'com.ultimategadgetlabs.electron-qa',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASS,
  })
}

function getGithubTag() {
  const regExp = new RegExp('^refs\\/tags\\/(v\\d\\.\\d\\.\\d)$')
  const result = regExp.exec(process.env.GITHUB_REF)

  return result && result[1]
}

function prepareDistDir() {
  fs.ensureDirSync(ELECTRON_BUILD_FOLDER)
  fs.copySync(path.join(__dirname, '../src'), ELECTRON_BUILD_FOLDER)

  const rootJson = fs.readJsonSync(path.join(__dirname, '../package.json'))
  const electronJson = fs.readJsonSync(path.join(__dirname, '../src/package.json'))
  electronJson.version = rootJson.version
  electronJson.dependencies = rootJson.dependencies
  fs.writeJsonSync(path.join(ELECTRON_BUILD_FOLDER, 'package.json'), electronJson, { spaces: 2 })
}
