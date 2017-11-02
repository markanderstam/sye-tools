const debug = require('debug')('sye')
import * as cp from 'child_process'
import * as os from 'os'
import * as prompt from 'prompt-sync'
import * as url from 'url'

let registryUsername = process.env.SYE_REGISTRY_USERNAME
let registryPassword = process.env.SYE_REGISTRY_PASSWORD

export function registryStart(ip, options) {
    let port = 5000
    let name = 'registry'
    let registryAddr = `${ip}:${port}`
    let registryUrl = `http://${ip}:${port}/${options.prefix}`
    let images = dockerLoad(options.file)
    if (images.length !== 1) {
        console.log(`Found ${images.length} images in ${options.file}, expected 1`)
        process.exit(1)
    }
    let image = images[0]
    console.log(`Using image ${image}`)

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
        console.log('Failed to start docker registry')
        process.exit(1)
    }
    console.log(`Registry URL: ${registryUrl}`)
}

export function registryAddImages(registryUrl, options) {

    if (urlRequiresCredentials(registryUrl)) {
        if (!(registryUsername && registryPassword)) {
            promptRegistryCredentials()
        }
    }

    let registryAddr = registryUrl.replace(/^(http|https):\/\//, '')
    if (registryUsername && registryPassword) {
        dockerLogin(registryUsername, registryPassword, registryAddr)
    }

    console.log('Loading images')
    let images = dockerLoad(options.file)
    for (let localName of images) {
//        let [, service, revision] = localName.match(/^.+\/(.+):(.+)$/)
        let remoteName = localName.replace(/^ott/, registryAddr)
        docker(`tag ${localName} ${remoteName}`)
        docker(`push ${remoteName}`)
    }

}

export function registryRemove() {
    let id = docker('ps -a -q --no-trunc --filter name=^/registry$')
    if (id) {
        console.log('Stopping registry container')
        docker('stop registry')

        console.log('Removing container')
        docker('rm -v registry')
    }
    else {
        console.log('No registry to remove')
    }
}

function docker(command: string) {
    try {
        return execSync('docker ' + command).toString()
    }
    catch (e) {
        // Docker prints its error-messages to stderr
        console.log('Docker command failed. Exiting.')
        process.exit(1)
        return ''
    }
}

function dockerLoad(tarFile) {
    let result = docker('load -q -i ' + tarFile)
    let images = result.split('\n')
        .filter(s => {
            if (s.match(/no space left on device/)) {
                console.log('Failed to load. No space left on device.')
                process.exit(1)
                return ''
            } else {
                return s.match(/^Loaded image: /)
            }
        })
        .map(s => s.replace(/^Loaded image: /, ''))
    return images
}

function dockerLogin(username, password, registry) {
    console.log('Login to external Docker registry.')
    if (registry.startsWith('docker.io')) {
        docker(`login -u ${username} -p ${password}`)
    } else {
        docker(`login -u ${username} -p ${password} ${registry}`)
    }
}

function registryCheckUrlFromUrl(registryUrl) {
    let u = url.parse(registryUrl)
    u.pathname = '/v2/'
    return url.format(u)
}

function urlRequiresCredentials(registryUrl) {
    return url.parse(registryUrl).host === 'docker.io'
}

function promptRegistryCredentials() {
    registryUsername = prompt('SYE_REGISTRY_USERNAME: ')
    registryPassword = prompt('SYE_REGISTRY_PASSWORD: ', { echo: '' })
}

export function verifyRoot(command) {
    if (os.userInfo().uid !== 0) {
        exit(1, `${command} must be run as root`)
    }
}

function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function exit(code, message) {
    console.log(message)
    process.exit(code)
}
