import * as os from 'os'
import * as fs from 'fs'
import * as url from 'url'
import * as semver from 'semver'
import * as net from 'net'
import { resolve } from 'path'
import { registryRequiresCredentials, setRegistryCredentials, getRegistryAddr } from '../sye-registry'
import { consoleLog, exit, execSync } from '../lib/common'
import { mkdirSync } from 'fs'

export interface ClusterCreateOptions {
    output: string
    release?: string
    check?: boolean
    internalIpv6?: boolean
    internalIpv4Nat?: boolean
}

export async function clusterCreate(registryUrl: string, etcdIps: string[], options: ClusterCreateOptions) {
    let registryUsername: string
    let registryPassword: string
    let registryAddr = getRegistryAddr(registryUrl)
    if (registryRequiresCredentials(registryAddr)) {
        ;[registryUsername, registryPassword] = await setRegistryCredentials(registryAddr)
    }

    let release =
        options.release ||
        releaseVersionFromRegistry(registryUrl, registryUsername, registryPassword) ||
        releaseVersionFromFile()
    consoleLog(`Using release ${release}`)

    if (options.internalIpv6 && options.internalIpv4Nat) {
        consoleLog('--internal-ipv6 and --internal-ipv4-nat cannot be used together')
    }

    if (options.check) {
        // Check that the registry URL is valid before creating the cluster config
        try {
            validateRegistryUrl(registryUrl, registryUsername, registryPassword, release)
        } catch (e) {
            exit(`Failed to get ${registryUrl}. Check that the registry url is correct. ${e}`)
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
            internalIPv4Nat: options.internalIpv4Nat ? 'yes' : 'no',
        },
        options.output
    )
}

export interface CreateCertsOptions {
    outputDir: string
}

export async function createCerts(configFile: string, options: CreateCertsOptions): Promise<void> {
    // Read the old configuration file
    createConfigurationFileForCertRotation(configFile, options.outputDir)
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
        exit('Docker authentication failed. Exiting.')
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

function createCertificates(destDir: string): void {
    execSync(
        `bash -c "openssl req -new -x509 -nodes -days 9999 -config <(cat) -keyout ${destDir}/ca.key -out ${destDir}/ca.pem 2>/dev/null"`,
        { input: opensslConf() }
    )
}

function createTarGzFile(baseDir: string, tarFile: string): void {
    const tmpfile = baseDir + 'sye-environment.tar'
    execSync(`chmod -R go-rwx '${baseDir}/keys'`)
    execSync(`tar -C '${baseDir}' -cf '${tmpfile}' global.json`)
    execSync(`tar -C '${baseDir}' -rf '${tmpfile}' keys`)
    execSync(`cat '${tmpfile}' | gzip > '${tarFile}'`)
}

function createConfigurationFile(content, output: string) {
    // Reset temporary credentials if registry is ECR and no access id and secret are provided as credentials
    if (
        content.registryUrl.includes('amazonaws.com') &&
        !(process.env.SYE_REGISTRY_USERNAME && process.env.SYE_REGISTRY_PASSWORD)
    ) {
        content.registryUsername = ''
        content.registryPassword = ''
    }
    let dir = os.platform() === 'darwin' ? fs.mkdtempSync('/private/tmp/') : fs.mkdtempSync('/tmp/')
    fs.writeFileSync(dir + '/global.json', JSON.stringify(content, undefined, 4))
    fs.mkdirSync(dir + '/keys')
    createCertificates(dir + '/keys')
    execSync(`cp ${dir}/keys/ca.pem ${dir}/keys/root_ca.pem`)
    createTarGzFile(dir, output)
    execSync(`rm -rf ${dir}`)
    consoleLog('Cluster configuration written to ' + output)
}

function createConfigurationFileForCertRotation(configFile: string, outputDir: string): void {
    const tempDir = os.platform() === 'darwin' ? fs.mkdtempSync('/private/tmp/') : fs.mkdtempSync('/tmp/')

    const oldDir = resolve(tempDir, 'old')
    mkdirSync(oldDir)
    const certDir = resolve(tempDir, 'certs')
    mkdirSync(certDir)
    const stage1Dir = resolve(tempDir, 'stage-1')
    const stage2Dir = resolve(tempDir, 'stage-2')
    const stage3Dir = resolve(tempDir, 'stage-3')

    // Unpack the current configuration tar file into oldDir
    execSync(`tar -C '${oldDir}' -zxf '${configFile}'`)

    // Create the new certificate
    createCertificates(certDir)

    // Construct the stage 1 files
    execSync(`cp -r '${oldDir}' '${stage1Dir}'`)
    execSync(`cat '${oldDir}/keys/root_ca.pem' '${certDir}/ca.pem' > '${stage1Dir}'/keys/root_ca.pem`)
    createTarGzFile(stage1Dir, resolve(outputDir, 'sye-environment-stage-1.tar.gz'))

    // Construct the stage 2 files
    execSync(`cp -r '${stage1Dir}' '${stage2Dir}'`)
    execSync(`cp '${certDir}/ca.pem' '${stage2Dir}'/keys/ca.pem`)
    execSync(`cp '${certDir}/ca.key' '${stage2Dir}'/keys/ca.key`)
    createTarGzFile(stage2Dir, resolve(outputDir, 'sye-environment-stage-2.tar.gz'))

    // Construct the stage 3 files
    execSync(`cp -r '${stage2Dir}' '${stage3Dir}'`)
    execSync(`cp '${certDir}/ca.pem' '${stage2Dir}'/keys/root_ca.pem`)
    createTarGzFile(stage3Dir, resolve(outputDir, 'sye-environment-stage-3.tar.gz'))

    execSync(`rm -rf ${tempDir}`)
    consoleLog('Cluster configuration written to ' + outputDir)
}

function opensslConf(): string {
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
