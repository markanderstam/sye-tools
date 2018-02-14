import * as cp from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as url from 'url'
import * as semver from 'semver'
import * as net from 'net'
import { registryRequiresCredentials, setRegistryCredentials, getRegistryAddr } from '../sye-registry'

const debug = require('debug')('sye')

export async function clusterCreate(registryUrl, etcdIps, options) {
    let registryUsername
    let registryPassword
    let registryAddr = getRegistryAddr(registryUrl)
    if (registryRequiresCredentials(registryAddr)) {
        ;[registryUsername, registryPassword] = await setRegistryCredentials(registryAddr)
    }

    let release =
        options.release ||
        releaseVersionFromRegistry(registryUrl, registryUsername, registryPassword) ||
        releaseVersionFromFile()
    consoleLog(`Using release ${release}`)

    if (options.check) {
        // Check that the registry URL is valid before creating the cluster config
        try {
            validateRegistryUrl(registryUrl, registryUsername, registryPassword, release)
        } catch (e) {
            consoleLog(`Failed to get ${registryUrl}. Check that the registry url is correct. ${e}`)
            process.exit(1)
        }
    }

    createConfigurationFile(
        {
            registryUrl,
            registryUsername,
            registryPassword,
            etcdHosts: etcdIps.map((ip) => (net.isIPv6(ip) ? `https://[${ip}]:2379` : `https://${ip}:2379`)),
            release,
            internalIPv6: options.internalIpv6 ? 'yes' : 'no',
        },
        options.output
    )
}

function getTokenFromDockerHub(username, password, repo, permissions) {
    try {
        let authRes = execSync(
            `curl -u '${username}:${password}' "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:${permissions.join(
                ','
            )}"`
        ).toString()
        return JSON.parse(authRes).token
    } catch (e) {
        consoleLog('Docker authentication failed. Exiting.')
        process.exit(1)
    }
}

function dockerRegistryApiUrlFromUrl(registryUrl) {
    let u = url.parse(registryUrl)
    u.pathname = u.pathname !== '/' ? '/v2' + u.pathname : '/v2'
    return url.format(u)
}

function requestToDockerHub(url, repo, registryUsername, registryPassword) {
    let token = getTokenFromDockerHub(registryUsername, registryPassword, repo, ['pull'])
    return JSON.parse(
        execSync(`curl -s -H "Accept: application/json" -H "Authorization: Bearer ${token}" "${url}"`).toString()
    )
}

function requestToAmazonECR(url, registryUsername, registryPassword) {
    return JSON.parse(execSync(`curl -s -k -u${registryUsername}:${registryPassword} ${url}`).toString())
}

function requestToLocalRegistry(url, registryUsername, registryPassword) {
    return JSON.parse(
        execSync(
            registryUsername && registryPassword
                ? `curl -s -k -u '${registryUsername}:${registryPassword}' ${url}`
                : `curl -s ${url}`
        ).toString()
    )
}

function validateRegistryUrl(registryUrl, registryUsername, registryPassword, release) {
    let p = url.parse(registryUrl)
    let res
    if (p.host.includes('docker.io')) {
        res = requestToDockerHub(
            dockerRegistryApiUrlFromUrl(registryUrl.replace('docker.io', 'registry.hub.docker.com')) +
                '/release/manifests/' +
                release,
            `${p.path.replace('/', '')}/release`,
            registryUsername,
            registryPassword
        )
    } else if (p.host.includes('amazonaws.com')) {
        res = requestToAmazonECR(
            dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + release,
            registryUsername,
            registryPassword
        )
    } else {
        res = requestToLocalRegistry(
            dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + release,
            registryUsername,
            registryPassword
        )
    }
    if (res.errors) {
        throw JSON.stringify(res.errors, null, 2)
    }
}

function releaseVersionFromFile() {
    try {
        return fs
            .readFileSync('./release_version')
            .toString()
            .trim()
    } catch (e) {
        throw 'Could not open release_version due to error: ' + e.stack
    }
}

// Get latest available release version from an external registry
function releaseVersionFromRegistry(registryUrl, registryUsername, registryPassword) {
    let res
    let p = url.parse(registryUrl)
    if (p.host === 'docker.io') {
        res = requestToDockerHub(
            dockerRegistryApiUrlFromUrl(registryUrl.replace('docker.io', 'registry.hub.docker.com')) +
                '/release/tags/list',
            `${p.path.replace('/', '')}/release`,
            registryUsername,
            registryPassword
        )
    } else if (p.host.endsWith('amazonaws.com')) {
        res = requestToAmazonECR(
            dockerRegistryApiUrlFromUrl(registryUrl) + '/release/tags/list',
            registryUsername,
            registryPassword
        )
    } else {
        res = requestToLocalRegistry(
            dockerRegistryApiUrlFromUrl(registryUrl) + '/release/tags/list',
            registryUsername,
            registryPassword
        )
    }
    if (res.errors) {
        throw `Failed to get latest avalaible release from ${registryUrl}: ${JSON.stringify(res.errors, null, 2)}`
    }
    return res.tags.length
        ? res.tags
              .filter((r) => r.match(/^r\d+\.\d+$/))
              .sort((a, b) => semver.compare(a.replace('r', '0.'), b.replace('r', '0.')))
              .pop()
        : undefined
}

function createConfigurationFile(content, output) {
    // Reset temporary credentials if registry is ECR and no access id and secret are provided as credentials
    if (
        content.registryUrl.includes('amazonaws.com') &&
        !(process.env.SYE_REGISTRY_USERNAME && process.env.SYE_REGISTRY_PASSWORD)
    ) {
        content.registryUsername = ''
        content.registryPassword = ''
    }
    let dir = os.platform() === 'darwin' ? fs.mkdtempSync('/private/tmp/') : fs.mkdtempSync('/tmp/')
    let tmpfile = dir + 'sye-environment.tar'
    fs.writeFileSync(dir + '/global.json', JSON.stringify(content, undefined, 4))
    fs.mkdirSync(dir + '/keys')
    execSync(
        `bash -c "openssl req -new -x509 -nodes -days 9999 -config <(cat) -keyout ${dir}/keys/ca.key -out ${dir}/keys/ca.pem 2>/dev/null"`,
        { input: opensslConf() }
    )
    execSync(`cp ${dir}/keys/ca.pem ${dir}/keys/root_ca.pem`)
    execSync(`chmod -R go-rwx ${dir}/keys`)
    execSync(`tar -C ${dir} -cf ${tmpfile} global.json`)
    execSync(`tar -C ${dir} -rf ${tmpfile} keys`)
    execSync(`cat ${tmpfile} | gzip > ${output}`)
    execSync(`rm -rf ${dir}`)
    consoleLog('Cluster configuration written to ' + output)
}

function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function consoleLog(msg: string): void {
    console.log(msg) // tslint:disable-line no-console
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
