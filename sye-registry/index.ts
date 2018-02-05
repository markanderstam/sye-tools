import * as cp from 'child_process'
import * as url from 'url'
import * as aws from 'aws-sdk'
import * as promptSync from 'prompt-sync'

const debug = require('debug')('sye')
const prompt = promptSync()

export function registryStart(ip, options) {
    let port = 5000
    let name = 'registry'
    let registryAddr = `${ip}:${port}`
    let registryUrl = `http://${ip}:${port}/${options.prefix}`
    let images = dockerLoad(options.file)
    if (images.length !== 1) {
        consoleLog(`Found ${images.length} images in ${options.file}, expected 1`)
        process.exit(1)
    }
    let image = images[0]
    consoleLog(`Using image ${image}`)

    docker(`run -d --net=host \
        --log-driver=json-file --log-opt max-size=20m --log-opt max-file=10 \
        --restart unless-stopped \
        -v registry-data:/var/lib/registry \
        -e "REGISTRY_HTTP_ADDR=${registryAddr}" \
        --name ${name} ${image}`)

    let checkUrl = registryCheckUrlFromUrl(registryUrl)
    let started = false
    for (let n = 0; n < 12 && !started; n++) {
        try {
            execSync(`curl -s ${checkUrl}`)
            started = true
        }
        catch (e) {
            execSync('sleep 5')
        }
    }
    if (!started) {
        consoleLog('Failed to start docker registry')
        process.exit(1)
    }
    consoleLog(`Registry URL: ${registryUrl}`)
}

export async function registryAddImages(registryUrl: string, options) {

    let registryAddr = getRegistryAddr(registryUrl)
    if (registryRequiresCredentials(registryAddr)) {
        let [ registryUsername, registryPassword ] = await setRegistryCredentials(registryAddr)
        dockerLogin(registryUsername, registryPassword, registryAddr)
    }

    consoleLog('Loading images')
    let images = dockerLoad(options.file)
    for (let localName of images) {
        let remoteName = getImageRemoteName(localName, registryUrl)
        docker(`tag ${localName} ${remoteName}`)
        docker(`push ${remoteName}`)
    }
}

export function registryRemove() {
    let id = docker('ps -a -q --no-trunc --filter name=^/registry$')
    if (id) {
        consoleLog('Stopping registry container')
        docker('stop registry')

        consoleLog('Removing container')
        docker('rm -v registry')
    }
    else {
        consoleLog('No registry to remove')
    }
}

function docker(command: string) {
    try {
        return execSync('docker ' + command).toString()
    }
    catch (e) {
        // Docker prints its error-messages to stderr
        exit(1, 'Docker command failed. Exiting.')
        return ''
    }
}

function dockerLoad(tarFile) {
    let result = docker('load -q -i ' + tarFile)
    let images = result.split('\n')
        .filter(s => {
            if (s.match(/no space left on device/)) {
                consoleLog('Failed to load. No space left on device.')
                process.exit(1)
                return ''
            } else {
                return s.match(/^Loaded image: /)
            }
        })
        .map(s => s.replace(/^Loaded image: /, ''))
    return images
}

function dockerLogin(username: string, password: string, registryAddr: string) {
    if (registryAddr.includes('docker.io')) {
        docker(`login -u ${username} -p ${password}`)
    } else {
        docker(`login -u ${username} -p ${password} ${registryAddr}`)
    }
    consoleLog('Successfully logged in to external Docker registry')
}

function registryCheckUrlFromUrl(registryUrl: string) {
    let u = url.parse(registryUrl)
    u.pathname = '/v2/'
    return url.format(u)
}

export function registryRequiresCredentials(registryAddr: string) {
    return registryAddr.includes('docker.io') || registryAddr.includes('amazonaws.com')
}

export async function setRegistryCredentials(registryAddr: string) {
    let registryUsername = process.env.SYE_REGISTRY_USERNAME
    let registryPassword = process.env.SYE_REGISTRY_PASSWORD

    if (!(registryUsername && registryPassword)) {
        if (registryAddr.includes('docker.io')) {
            [ registryUsername, registryPassword ] = promptRegistryCredentials()
        }
        if (registryAddr.includes('amazonaws.com')) {
            [ registryUsername, registryPassword ] = await authorizeFromECR(registryAddr)
        }
    }

    return [ registryUsername, registryPassword ]
}

export function getRegistryAddr(registryUrl: string) {
    let u = url.parse(registryUrl)
    return u.host
}

function getImageRemoteName(localName: string, registryUrl: string) {
    let u = url.parse(registryUrl)
    if (u.host.includes('amazonaws.com')) {
        return localName.replace(/^ott/, `${u.host}${u.path}`)
    } else {
        return localName.replace(/^ott/, u.host)
    }
}

async function authorizeFromECR(registryAddr: string) {
    try {
        let c = new aws.ECR({
            endpoint: 'https://' + registryAddr.match(/.*\.dkr\.(ecr\..*)/)[1],
            region: registryAddr.match(/ecr.(.*).amazonaws.com/)[1]
        })
        let token = Buffer.from(
            (await c.getAuthorizationToken({}).promise()).authorizationData[0].authorizationToken, 'base64'
        ).toString().split(':')[1]
        return [ 'AWS', token ]
    } catch(e) {
        exit(1, `Failed to retrieve authorization token from ECR: ${e.message}`)
        return ''
    }
}

function promptRegistryCredentials() {
    const registryUsername = prompt('SYE_REGISTRY_USERNAME: ')
    const registryPassword = prompt('SYE_REGISTRY_PASSWORD: ', { echo: '' })
    return [ registryUsername, registryPassword ]
}

function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function exit(code: number, message: string) {
    consoleLog(message)
    process.exit(code)
}

function consoleLog(msg: string): void {
    console.log(msg) // tslint:disable-line no-console
}
