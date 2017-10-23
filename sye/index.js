/**
 * Module dependencies.
 */

'use strict'

const program = require('commander');
const cp = require('child_process')
const os = require('os')
const fs = require('fs')
const url = require('url')
const debug = require('debug')('sye')
const prompt = require('prompt-sync')()
const net = require('net')

const confdir = '/etc/sye'
let registryUsername = process.env.SYE_REGISTRY_USERNAME
let registryPassword = process.env.SYE_REGISTRY_PASSWORD

function collectTags(tag, tags) {
    tags.push(tag)
    return tags
}

program
    .version('0.0.1')
    .usage('[command] <options>')

program
    .command('registry-start <ip>')
    .description('Start a docker registry on this machine')
    .option('-p, --prefix <name>', 'registry prefix name, default ott', 'ott')
    .option('-f, --file <filename>', 'file with registry image, default ./registry.tar', './registry.tar')
    .action( registryStart )

program
    .command('registry-add-release <registry-url>')
    .description('Add a sye release to a docker registry')
    .option('-f, --file <filename>', 'file with images, default ./images.tar', './images.tar')
    .action( registryAddImages )

program
    .command('registry-add-images <registry-url>')
    .description('Add stand-alone sye images to a docker registry')
    .option('-f, --file <filename>', 'file with images, default ./images.tar.gz', './images.tar.gz')
    .action( registryAddImages )

program
    .command('registry-remove')
    .description('Remove the docker registry running on this machine')
    .action( registryRemove )

program
    .command('cluster-create <registry-url> <etcd-ip...>')
    .description('Create a configuration file for a cluster')
    .option('-o, --output <filename>', 'configuration filename, default sye-environment.tar.gz',
        './sye-environment.tar.gz')
    .option('--release <release>', 'Use a specific release. Defaults to latest available in registry')
    .option('-n, --no-check', 'Don\'t try to connect to registry.')
    .option('--internal-ipv6', 'Use IPv6 for internal communication')
    .action( clusterCreate )

program
    .command('cluster-join')
    .description('Add this machine to a cluster')
    .option('-f, --file <filename>', 'configuration filename',
        './sye-environment.tar.gz')
    .option('--mc-version <revision>', 'start a specific version of the machine-controller')
    .option('--single <interface-name>', 'start single-pitcher services listening on an interface', '')
    .option('--management <interface-name>', 'start management services listening on an interface', '')
    .option('-p, --management-port <port>', 'start playout-management listening on a port', '81')
    .option('-t, --management-tls-port <port>', 'start playout-management listening on a TLS port', '4433')
    .option('--machine-name <machine-name>', 'name for this machine, defaults to hostname', false)
    .option('--location <location>', 'location for this machine, default "Unknown"', 'Unknown')
    .option('--machine-region <machine-region>', 'region for this machine, default "default"', 'default')
    .option('--machine-zone <machine-zone>', 'zone for this machine, default "default"', 'default')
    .option('--machine-tag <machine-tag>', 'optional tags for this machine, default "[]"', collectTags, [])
    .action( clusterJoin )

program
    .command('cluster-leave')
    .description('Remove machine-controller and all service containers from this node')
    .option('--force', 'Disable warning')
    .action( clusterLeave )

program
    .command('single-server <interface>')
    .description('Start a single server installation')
    .option('-p, --management-port <port>', 'start playout-management listening on a port', '81')
    .option('-t, --management-tls-port <port>', 'start playout-management listening on a TLS port', '4433')
    .description('Install a single-server setup on this machine')
    .action( singleServer )

program
    .command('*')
    .action( help )

program
  .parse(process.argv)

if (!process.argv.slice(2).length) {
    help()
}

function help() {
    program.outputHelp()
    console.log('Use <command> -h for help on a specific command.\n')
    process.exit(1)
}

function registryStart(ip, options) {
    let port = 5000
    let name = 'registry'
    let registryAddr = `${ip}:${port}`
    let registryUrl = `http://${ip}:${port}/${options.prefix}`
    let images = dockerLoad(options.file)
    if(images.length !== 1) {
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
    for( let n=0; n<12 && !started; n++) {
        try {
            execSync(`curl -s ${checkUrl}`)
            started = true
        }
        catch (e) {
            execSync('sleep 5')
        }
    }
    if( !started ) {
        console.log('Failed to start docker registry')
        process.exit(1)
    }
    console.log(`Registry URL: ${registryUrl}`)
}

function registryAddImages(registryUrl, options) {

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
    for( let localName of images ) {
        let [, service, revision] = localName.match(/^.+\/(.+):(.+)$/)
        let remoteName = localName.replace(/^ott/, registryAddr)
        docker(`tag ${localName} ${remoteName}`)
        docker(`push ${remoteName}`)
    }

}

function registryRemove() {
    let id = docker('ps -a -q --no-trunc --filter name=^/registry$')
    if(id) {
        console.log('Stopping registry container')
        docker('stop registry')

        console.log('Removing container')
        docker('rm -v registry')
    }
    else {
        console.log('No registry to remove')
    }
}

function clusterCreate( registryUrl, etcdIps, options ) {
    let release = options.release || releaseVersionFromFile()
    console.log(`Using release ${release}`)

    if(urlRequiresCredentials(registryUrl)) {
        if(!(registryUsername && registryPassword)) {
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

function clusterJoin( options ) {
    verifyRoot('cluster-join')
    configSystemForLogService()

    if( options.single && options.management ) {
        exit(1, 'Cannot be both single-server and management at the same time. Single-server includes management. Exiting.')
    }

    // extrac cluster configuration file to ${confdir}
    extractConfigurationFile(confdir, options)

    let global = JSON.parse(fs.readFileSync(confdir + '/global.json'))
    let containerName = 'machine-controller-1'
    let machineControllerVersion = options['mcVersion']
        || imageReleaseRevision('machine-controller', global.release, global.registryUrl, global.registryUsername,
            global.registryPassword)

    if (global.registryUsername && global.registryPassword) {
        dockerLogin(global.registryUsername, global.registryPassword, global.registryUrl.replace(/^(http|https):\/\//, ''))
    }

    let registryPrefix = registryPrefixFromUrl(global.registryUrl)

	docker(`run -d \
		-e "SINGLE_SERVER_IF=${options.single}" \
        -e "BOOTSTRAP_IF=${options.management}" \
        -e "CONTAINER_NAME=${containerName}" \
        -e "MEMORY_LIMIT=256" \
		-e "MACHINE_REGION=${options.machineRegion}" \
		-e "MACHINE_ZONE=${options.machineZone}" \
        -e "MACHINE_TAGS=${options.machineTag}" \
        -e "MANAGEMENT_PORT=${options.managementPort}" \
        -e "MANAGEMENT_TLS_PORT=${options.managementTlsPort}" \
		-v /etc/sye:/etc/sye:rw \
		-v /var/lib/docker/volumes:/var/lib/docker/volumes:rw \
		-v /tmp/cores:/tmp/cores:rw \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v /etc/passwd:/etc/passwd:ro \
		-v /etc/group:/etc/group:ro \
		--net=host \
		--log-driver=json-file \
		--log-opt max-size=20m \
		--log-opt max-file=10 \
        --memory 256M \
		--restart always \
		--name ${containerName} ${registryPrefix}/machine-controller:${machineControllerVersion}
    `)
    // start machine-controller
}

function clusterLeave( options ) {
    verifyRoot('cluster-leave')

    let services = [
        'machine-controller-',
        'pitcher_',
        'frontend_',
        'frontend-balancer_',
        'playout-management_',
        'playout-controller_',
        'log_',
        'login_',
        'log-viewer_',
        'influxdb_',
        'metric-viewer_',
        'cluster-monitor_',
        'etcd_',
        'video-source_',
        'zookeeper_',
        'kafka_',
        'ad-impression-router_',
        'ad-session-router_',
        'ad-vast-requester_',
        'ad-vast-reporter_',
        'ad-deduplicator_',
        'ad-playlist_',
        'scaling_',
        'schema-registry_',
    ]

    services.forEach( s => {stopAllInstances(s) })
    services.forEach( s => {removeAllInstances(s) })
    services.forEach( s => removeVolume(s) )

    execSync('rm -rf /etc/sye')
}

function singleServer( networkInterface, options ) {
    verifyRoot('single-server')
    configSystemForLogService()

    let ip
    try {
        ip = os.networkInterfaces()[networkInterface].filter( v => v.family === 'IPv4')[0].address
    }
    catch(e) {}

    if(!ip) {
        console.log('Failed to find ip address of interface ' + networkInterface)
        process.exit(1)
    }

    console.log('\n> sye cluster-leave')
    clusterLeave()

    console.log('\n> sye registry-remove')
    registryRemove()

    console.log( '\n> sye registry-start 127.0.0.1')
    registryStart('127.0.0.1', {prefix: 'ott', file: './registry.tar'})

    console.log( '\n> sye registry-add-release http://127.0.0.1:5000/ott')
    registryAddImages('http://127.0.0.1:5000/ott', {file: './images.tar'})

    console.log( '\n> sye cluster-create http://127.0.0.1:5000/ott 127.0.0.1')
    clusterCreate('http://127.0.0.1:5000/ott', ['127.0.0.1'], {output: './sye-environment.tar.gz'})

    console.log( '\n> sye cluster-join')
    clusterJoin({
        single: networkInterface,
        management: '',
        file: './sye-environment.tar.gz',
        location: 'Unknown',
        managementPort: options.managementPort,
        managementTlsPort: options.managementTlsPort
    })

    execSync(`rm sye-environment.tar.gz`)

    console.log('System is starting. Will be available on http://' + ip + ':81')
}

function docker(command) {
    try {
        return execSync('docker ' +  command).toString()
    }
    catch (e) {
        // Docker prints its error-messages to stderr
        console.log('Docker command failed. Exiting.')
        process.exit(1)
    }
}

function dockerLoad(tarFile) {
    let result = docker('load -q -i ' + tarFile)
    let images = result.split('\n')
        .filter(s => {
            if (s.match(/no space left on device/)) {
                console.log('Failed to load. No space left on device.')
                process.exit(1)
            } else {
                return s.match(/^Loaded image: /)
            }
        })
        .map( s => s.replace(/^Loaded image: /, ''))
    return images
}

function dockerLogin(username, password, registry) {
    console.log('Login external Docker registry')
    if (registry.startsWith('docker.io')) {
        docker(`login -u ${username} -p ${password}`)
    } else {
        docker(`login -u ${username} -p ${password} ${registry}`)
    }
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

function registryCheckUrlFromUrl(registryUrl) {
    let u = url.parse(registryUrl)
    u.pathname = '/v2/'
    return url.format(u)
}

function dockerRegistryApiUrlFromUrl(registryUrl) {
	let u = url.parse(registryUrl)
	u.pathname = '/v2' + u.pathname
	return url.format(u)
}

function registryPrefixFromUrl(registryUrl) {
	let u = url.parse(registryUrl)
    return `${u.host}${u.pathname}`

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
    } else { // Request against Docker registry V2 endpoint
        let url = dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + release
        let cmd = registryUsername && registryPassword ? `curl -s -k -u${registryUsername}:${registryPassword} ${url}` :  `curl -s ${url}`
        let res = execSync(cmd).toString()
    }
}

function urlRequiresCredentials(registryUrl) {
    return url.parse(registryUrl).host === 'docker.io'
}

function promptRegistryCredentials() {
    registryUsername = prompt('SYE_REGISTRY_USERNAME: ')
    registryPassword = prompt('SYE_REGISTRY_PASSWORD: ', {echo: ''})
}

function releaseVersionFromFile() {
    try {
      return fs.readFileSync('./release_version').toString().trim()
    }
    catch(e) {
      throw 'Could not open release_version due to error: ' + e.stack
    }
}

function imageReleaseRevision(image, releaseRevision, registryUrl, registryUsername, registryPassword) {
    // Return the revision of image that is included in a specific
    // release.
    let p = url.parse(registryUrl)
    try {
        let url
        let cmd
        if (p.host === 'docker.io') { // Request against Docker Hub
            url = dockerRegistryApiUrlFromUrl(registryUrl.replace('docker.io', 'registry.hub.docker.com')) + '/release/manifests/' + releaseRevision
            let token = getTokenFromDockerHub(registryUsername, registryPassword, `${p.path.replace('/', '')}/release`, ['pull'])
            cmd = `curl -s -H "Accept: application/json" -H "Authorization: Bearer ${token}" "${url}"`
        } else { // Request against Docker registry V2 endpoint
            url = dockerRegistryApiUrlFromUrl(registryUrl) + '/release/manifests/' + releaseRevision
            cmd = registryUsername && registryPassword ? `curl -s -k -u${registryUsername}:${registryPassword} ${url}` :  `curl -s ${url}`
        }
        let manifest = execSync(cmd).toString()
        let labelInfo = JSON.parse(manifest).history[0].v1Compatibility
        let labels = JSON.parse(labelInfo).container_config.Labels
        return labels['systems.neti.servicerevision.' + image]
    }
    catch(err) {
        console.error(`Failed to get revision for image ${image} in release ${releaseRevision} from registry at ${registryUrl}`) // eslint-disable-line
        process.exit(1)
    }
}

function createConfigurationFile(content, output) {
    let dir = os.platform() === 'darwin' ? fs.mkdtempSync('/private/tmp/'): fs.mkdtempSync('/tmp/')
    let tmpfile = dir + 'sye-environment.tar'
    fs.writeFileSync( dir + '/global.json', JSON.stringify(content, undefined,4))
    fs.mkdirSync(dir + '/keys')
    execSync(`bash -c "openssl req -new -x509 -nodes -days 9999 -config <(cat) -keyout ${dir}/keys/ca.key -out ${dir}/keys/ca.pem 2>/dev/null"`, {input: opensslConf()})
    execSync(`cp ${dir}/keys/ca.pem ${dir}/keys/root_ca.pem`)
    execSync(`chmod -R go-rwx ${dir}/keys`)
    execSync(`tar -C ${dir} -cf ${tmpfile} global.json`)
    execSync(`tar -C ${dir} -rf ${tmpfile} keys`)
    execSync(`cat ${tmpfile} | gzip > ${output}`)
    execSync(`rm -rf ${dir}`)
    console.log('Cluster configuration written to ' + output)
}

function extractConfigurationFile(confdir, options) {
    try {
        fs.statSync(confdir)
        exit(1, `${confdir} already exists. Exiting.`)
    }
    catch(e) {}
    fs.mkdirSync(confdir)
    fs.mkdirSync(`${confdir}/instance-data`)
    execSync(`tar -xzf ${options.file} -C ${confdir}`)
    let machine = {
        location: options.location,
        machineName: options.machineName || execSync('hostname --fqdn').toString().replace('\n','')
    }
    fs.writeFileSync( confdir + '/machine.json', JSON.stringify(machine, undefined,4))
}

function verifyRoot(command) {
    if (os.userInfo().uid !== 0) {
    	exit(1, `${command} must be run as root`)
    }
}

function configSystemForLogService() {
    try {
        // Replace the value of vm.max_map_count inline or add it to the end of the file is it doesn't exist
        // reference here: https://superuser.com/questions/590630/sed-how-to-replace-line-if-found-or-append-to-end-of-file-if-not-found
        execSync("sed '/^vm.max_map_count = /{h;s/=.*/= 262144/};${x;/^$/{s//vm.max_map_count = 262144/;H};x}' -i /etc/sysctl.conf") // eslint-disable-line
        execSync('sysctl -p')
    } catch (e) {
        console.log(e)
        exit(1, `Cannot set the OS parameter 'vm.max_map_count' to 262144. Exiting.`)
    }
}

function execSync(cmd, options) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function exit(code, message) {
	console.log(message)
	process.exit(code)
}

function stopAllInstances(serviceName) {
    execSync(`docker ps | grep ${serviceName} | awk '{FS=" "; print $1}' | xargs -r docker stop`)
}

function removeAllInstances(serviceName) {
    execSync(`docker ps -a | grep ${serviceName} | awk '{FS=" "; print $1}' | xargs -r docker rm -v`)
}

function removeVolume(serviceName) {
    execSync(`docker volume ls | grep ${serviceName} | awk '{FS=" "; print $2}' | xargs -r docker volume rm`)
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
