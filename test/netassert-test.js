const test = require('ava')

const nmap = require('node-nmap')
nmap.nmapLocation = '/usr/bin/nmap' // default
const { join } = require('path')

const { isNegation, replaceNegationOperator, findLocalPortsToTest, stripProtocol } = require('../lib/ports')
const { buildNmapOptions, scan, SCAN_TIMEOUT_MILLIS } = require('../lib/scanner')
const { loadTests } = require('../lib/io')

const debug = (process.env.DEBUG === '0' ? false : (!!process.env.DEBUG ? true : !!process.env.REMOTE_DEBUG))
process.setMaxListeners(200)

// console.log(`# DEBUG: ${debug} - ENV: ${process.env.DEBUG}`)

function log () {
  if (debug) {
    // process.stdout.write('# ')
    console.log.apply(null, arguments)
  }
}

const tests = loadTests(join(__dirname, 'test.yaml'))
log(tests)

const runTests = (tests) => {
  Object.keys(tests).forEach((testType) => {

    switch (testType) {
      case 'k8s':
      case 'kubernetes':
        log('k8s tests')
        log('NOT IMPLEMENTED')
        break

      case 'host':
      case 'instance':
        runHostTests(tests[testType])
        break
      default:
        console.error(`Unknown test type ${testType}`)
        process.exit(1)
    }

    log()
  })
}

const runHostTests = (tests) => {
  log('host tests', tests)

  Object.keys(tests).forEach((testType) => {

    switch (testType) {
      case 'localhost':
        runHostLocalTests(tests[testType])
        break

      default:
        if (testType.substr(0, 1) === '_') {
          runHostLocalTests(tests[testType])
        } else {
          console.error(`Unknown test type ${testType}`)
          process.exit(1)
        }
    }

    log()
  })
}

const runHostLocalTests = (tests) => {
  log('host local tests', tests)

  Object.keys(tests).forEach((host) => {
    var portsToTest = findLocalPortsToTest(tests[host])

    log('all ports to test', portsToTest)
    log(`test ${host}, ports ${portsToTest.join(',')}`, JSON.stringify(portsToTest))

    const tcpPortsToTest = portsToTest.filter(tcpOnly)
    tcpPortsToTest.forEach(port => test.cb(openTcp, host, [port]))

    const udpPortsToTest = portsToTest.filter(udpOnly)
    udpPortsToTest.forEach(port => test.cb(openUdp, host, [port]))

    log()
  })
  log()
}

// ---

function openTcp (t, host, portsToTest) {
  assertPortsOpen(t, host, portsToTest, 'tcp')
}

function openUdp (t, host, portsToTest) {
  assertPortsOpen(t, host, portsToTest, 'udp')
}

openTcp.title = (providedTitle, host, expectedPorts) => {
  expectedPorts = getTestName(expectedPorts)
  return `${providedTitle} ${host} TCP:${expectedPorts.join(',')}`.trim()
}

openUdp.title = (providedTitle, host, expectedPorts) => {
  expectedPorts = getTestName(expectedPorts)
  return `${providedTitle} ${host} UDP:${expectedPorts.join(',')}`.trim()
}

const getTestName = (expectedPorts) => {
  return expectedPorts.map(port => {
    const closed = isNegation(port)
    port = replaceNegationOperator(port).split(':')
    return `${port[port.length - 1]} ${closed ? 'closed' : 'open'}`
  })
}

// ---

const assertPortsOpen = (t, hosts, portsToTest, protocol = 'tcp') => {

  if (!Array.isArray(hosts)) {
    hosts = hosts.split(' ')
  }

  if (portsToTest.length < 1) {
    return t.end()
  }

  // Remove the protocols preserving the negation operator
  // [ "-TCP:80", "TCP:443" ] -> [ "-80", "443" ]
  let expectedPorts = portsToTest.map(stripProtocol)

  // Extract just the port numbers - we'll loop over the results and compre with expectedPorts to check whether they
  // are open or closed
  // [ "-80", "443" ] -> [ "80", "443" ]
  portsToTest = expectedPorts.map(replaceNegationOperator)

  log('ports to test', portsToTest, portsToTest.length)
  log('expected ports', expectedPorts, expectedPorts.length)

  let expectedTests = hosts.length * portsToTest.length
  log('expected', expectedTests)
  t.plan(expectedTests)

  // TODO(rem): we're only scanning the first host here!
  scan(hosts[0], portsToTest, protocol, (error, scanResults) => {
    if (error) {
        log(error)
        t.fail(error)
        return t.end()
    }

    log(`results for ${protocol}`)
    log(JSON.stringify(scanResults, null, 2))
    log(`proto ${protocol}:`, JSON.stringify(portsToTest, null, 2))

    let foundPorts = []
    if (scanResults.length && scanResults[0].openPorts) {
      if (scanResults.length > 1) {
        t.fail(`Only one host supported per scan, found ${scanResults.length}`)
      }

      scanResults[0].openPorts.forEach((openPort) => {
        if (openPort.protocol != protocol) {
          t.fail(`protocol mismatch: ${openPort.protocol} != ${protocol}`)
        }

        log(`open port on ${host}`, openPort)
        foundPorts.push(parseInt(openPort.port, 10))
      })
    }

    expectedPorts.forEach(expectedPort => {
      log('all ports, this one', expectedPort)
      const closed = isNegation(port)
      if (closed) {
        expectedPort = parseInt(expectedPort.substr(1), 10)
        log('asserting', expectedPort, 'is NOT IN', foundPorts)
        t.falsy(
          foundPorts.includes(expectedPort),
          `${host}: expected ${protocol}:${expectedPort} to be closed, found [${foundPorts.join(',')}]`
        )

      } else {
        log('asserting', expectedPort, 'in', foundPorts)
        expectedPort = parseInt(expectedPort, 10)
        t.truthy(
          foundPorts.includes(expectedPort),
          `${host}: expected ${protocol}:${expectedPort} to be open, found [${foundPorts.join(',')}]`
        )
      }
    })

    log('done')
    t.end()
  })
}

// ---

function tcpOnly (ports) {
  ports = replaceNegationOperator(ports)
  if (ports.substr(0, 4) === 'TCP:') {
    return true
  }
  return ports.substr(0, 4) !== 'UDP:' && ports.substr(0, 5) !== 'ICMP:'
}

function udpOnly (ports) {
  return (replaceNegationOperator(ports).substr(0, 4) === 'UDP:')
}

// TODO(ajm) not implemented
function icmpOnly (ports) {
  return (replaceNegationOperator(ports).substr(0, 5) === 'ICMP:')
}

runTests(tests)
