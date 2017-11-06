import * as cp from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as url from 'url'

const debug = require('debug')('sye')
const prompt = require('prompt-sync')()
import * as net from 'net'

let registryUsername = process.env.SYE_REGISTRY_USERNAME
let registryPassword = process.env.SYE_REGISTRY_PASSWORD

export function clusterCreate(registryUrl, etcdIps, options) {
    let release = options.release ||  releaseVersionFromFile()
    console.log(`Using release ${release}`)

    if (urlRequiresCredentials(registryUrl)) {
        if (!(registryUsername && registryPassword)) {
            promptRegistryCredentials()
        }
    }

    if (options.check) {
        // Check that the registry URL is valid before creating the cluster config
        try {
            validateRegistryUrl(registryUrl, release)
        } catch (e) {
            console.log(`Failed to get ${registryUrl}. Check that the registry url is correct. ${e}`)
            process.exit(1)
        }
    }
    createConfigurationFile({
        registryUrl,
        registryUsername,
        registryPassword,
        etcdHosts: etcdIps.map(ip => net.isIPv6(ip) ? `https://[${ip}]:2379` : `https://${ip}:2379`),
        release,
        internalIPv6: options.internalIpv6 ? 'yes' : 'no',
    }, options.output)
}

function getTokenFromDockerHub(username, password, repo, permissions) {
    try {
        let authRes = execSync(`curl -u ${username}:${password} "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:${permissions.join(',')}"`).toString()
        return JSON.parse(authRes).token
    }
    catch (e) {
        console.log('Docker authentication failed. Exiting.')
        process.exit(1)
    }
}

function dockerRegistryApiUrlFromUrl(registryUrl) {
    let u = url.parse(registryUrl)
    u.pathname = u.pathname !== '/' ? '/v2' + u.pathname : '/v2'
    return url.format(u)
}

function validateRegistryUrl(registryUrl, release) {
    let p = url.parse(registryUrl)
    if (p.host === 'docker.io') { // Request against Docker Hub
        let url = dockerRegistryApiUrlFromUrl(registryUrl.replace('docker.io', 'registry.hub.docker.com')) + '/release/manifests/' + release
        let token = getTokenFromDockerHub(registryUsername, registryPassword, `${p.path.replace('/', '')}/release`, ['pull'])
        let res = JSON.parse(execSync(`curl -s -H "Accept: application/json" -H "Authorization: Bearer ${token}" "${url}"`).toString())
        if (res.errors) {
            throw JSON.stringify(res.errors, null, 2)
        }
    } else if (p.host.endsWith('amazonaws.com')) { // Request against Amazon Docker registry
        let url = dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + release
        let res = JSON.parse(execSync(`curl -s -k -u${registryUsername}:${registryPassword} ${url}`).toString())
        if (res.errors) {
            throw JSON.stringify(res.errors, null, 2)
        }
    } else { // Request against Docker registry V2 endpoint
        let url = dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + release
        let cmd = registryUsername && registryPassword ? `curl -s -k -u${registryUsername}:${registryPassword} ${url}` : `curl -s ${url}`
        execSync(cmd)
    }
}

function urlRequiresCredentials(registryUrl) {
    let p = url.parse(registryUrl)
    return p.host === 'docker.io' || p.host.endsWith('amazonaws.com')
}

function promptRegistryCredentials() {
    registryUsername = prompt('SYE_REGISTRY_USERNAME: ')
    registryPassword = prompt('SYE_REGISTRY_PASSWORD: ', { echo: '' })
}

function releaseVersionFromFile() {
    try {
        return fs.readFileSync('./release_version').toString().trim()
    }
    catch (e) {
        throw 'Could not open release_version due to error: ' + e.stack
    }
}

function createConfigurationFile(content, output) {
    let dir = os.platform() === 'darwin' ? fs.mkdtempSync('/private/tmp/') : fs.mkdtempSync('/tmp/')
    let tmpfile = dir + 'sye-environment.tar'
    fs.writeFileSync(dir + '/global.json', JSON.stringify(content, undefined, 4))
    fs.mkdirSync(dir + '/keys')
    execSync(`bash -c "openssl req -new -x509 -nodes -days 9999 -config <(cat) -keyout ${dir}/keys/ca.key -out ${dir}/keys/ca.pem 2>/dev/null"`, { input: opensslConf() })
    execSync(`cp ${dir}/keys/ca.pem ${dir}/keys/root_ca.pem`)
    execSync(`chmod -R go-rwx ${dir}/keys`)
    execSync(`tar -C ${dir} -cf ${tmpfile} global.json`)
    execSync(`tar -C ${dir} -rf ${tmpfile} keys`)
    execSync(`cat ${tmpfile} | gzip > ${output}`)
    execSync(`rm -rf ${dir}`)
    console.log('Cluster configuration written to ' + output)
}

function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function opensslConf() {
    return `
[ ca ]
default_ca      = CA_default

[ CA_default ]
serial = ca-serial
crl = ca-crl.pem
database = ca-database.txt
name_opt = CA_default
cert_opt = CA_default
default_crl_days = 9999
default_md = md5

[ req ]
default_bits           = 2048
days                   = 9999
distinguished_name     = req_distinguished_name
attributes             = req_attributes
prompt                 = no

[ req_distinguished_name ]
C                      = SE
ST                     = Stockholm
L                      = Stockholm
O                      = Net Insight
OU                     = ott
CN                     = ca
emailAddress           = ca@neti.systems

[ req_attributes ]
challengePassword      = test
`
}
