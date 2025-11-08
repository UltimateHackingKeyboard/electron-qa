'use strict'
import { exec, execSync } from 'node:child_process'

const __dirname = import.meta.dirname
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

import path from 'node:path'
import {setTimeout} from 'node:timers/promises'
import builder from 'electron-builder'
import fs from 'fs-extra'
import pThrottle from 'p-throttle'
import pRetry from 'p-retry'

const Platform = builder.Platform
const ELECTRON_BUILD_FOLDER = path.join(__dirname, '../tmp-build')

let target = ''
let artifactName = 'Electron-QA-${version}-${os}'

if (process.platform === 'darwin') {
  target = Platform.MAC.createTarget('default', builder.Arch.universal)
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

if (process.platform === 'darwin') {
  const encryptedFile = path.join(__dirname, './certs/mac-cert.p12.enc')
  const decryptedFile = path.join(__dirname, './certs/mac-cert.p12')
  execSync(`openssl aes-256-cbc -K $CERT_KEY -iv $CERT_IV -in ${encryptedFile} -out ${decryptedFile} -d`)
}

const APPLE_TEAM_ID = 'CMXCBCFHDG'
process.env.APPLE_TEAM_ID = APPLE_TEAM_ID

if (TEST_BUILD || gitTag) {
  prepareDistDir()

  builder.build({
    targets: target,
    config: {
      directories: {
        app: ELECTRON_BUILD_FOLDER
      },
      appId: 'com.ultimategadgetlabs.electron-qa',
      productName: 'Electron QA',
      mac: {
        category: 'public.app-category.utilities',
        identity: APPLE_TEAM_ID,
        cscLink: path.join(__dirname, 'certs/mac-cert.p12'),
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: path.join(__dirname, 'entitlements.mac.plist'),
        entitlementsInherit: path.join(__dirname, 'entitlements.mac.plist'),
      },
      win: {
        signtoolOptions: {
          publisherName: 'Ultimate Gadget Laboratories Kft.',
          sign: configuration => azureKeyvaultSign(configuration.path),
        },
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

function getGithubTag() {
  const regExp = new RegExp('^refs\\/tags\\/(v\\d+\\.\\d+\\.\\d+)$')
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

// sign only 1 file in every 2 sec
// otherwise we got random singing error
// maybe related issue https://github.com/vcsjones/AzureSignTool/issues/330
const throttleAzureCodeSign = pThrottle({
	limit: 1,
	interval: 2000
});

const azureKeyvaultSign = throttleAzureCodeSign(async (filePath) => {
  const {
      AZURE_KEY_VAULT_TENANT_ID,
      AZURE_KEY_VAULT_CLIENT_ID,
      AZURE_KEY_VAULT_SECRET,
      AZURE_KEY_VAULT_URL,
      AZURE_KEY_VAULT_CERTIFICATE,
    } = process.env;

  if (!AZURE_KEY_VAULT_URL) {
    console.log('Skipping code signing, no environment variables set for that.')
    return
  }

  return pRetry(() => new Promise((resolve, reject) => {
    console.log('Signing file', filePath);
    const signToolPath = path.join(__dirname, 'AzureSignTool-x64-6-0-1.exe')
    const command = `${signToolPath} sign -kvu ${AZURE_KEY_VAULT_URL} -kvi ${AZURE_KEY_VAULT_CLIENT_ID} -kvt ${AZURE_KEY_VAULT_TENANT_ID} -kvs ${AZURE_KEY_VAULT_SECRET} -kvc ${AZURE_KEY_VAULT_CERTIFICATE} -tr http://timestamp.identrust.com -v '${filePath}'`;
    exec(command, { shell: 'powershell.exe' }, (e, stdout, stderr) => {
      if (e instanceof Error) {
        console.error(e)
        return reject(e)
      }

      if (stderr) {
        console.error(stderr)
        return reject(new Error(stderr))
      }

      if (stdout.indexOf('Signing completed successfully') > -1) {
        console.log(stdout)
        return resolve()
      }

      return reject(new Error(stdout))
    })
  }), {
    retries: 5,
    onFailedAttempt: async ({error, attemptNumber, retriesLeft, retriesConsumed}) => {
      console.log('Signing file failed', filePath);
		  console.log(`Attempt ${attemptNumber} failed. ${retriesLeft} retries left. ${retriesConsumed} retries consumed.`);
      console.error(error)

      console.log('wait 5 sec before retry')
      await setTimeout(5000)
	  },
  })
})
