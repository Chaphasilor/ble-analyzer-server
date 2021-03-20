const StreamArray = require('stream-json/streamers/StreamArray');
const fs = require('fs');
const { spawn } = require(`child_process`)
const EventEmitter = require(`events`)
const CBuffer = require(`cbuffer`)

const Packet = require(`./packet`)

// debug stuff
let connectionStartCounter = 0
let connectionEndCounter = 0
let connectionPacketCounter = 0

module.exports = class Parser extends EventEmitter {

  constructor() {

    super()

    this.packetBuffer = new CBuffer(100000) // only keep the last 100000 packets in memory
    this.connections = new Map() // remember sniffed connections. key is access address
    this.advertisers = new Map() // remember sniffed advertisers. key is advertising address
    this.issues = [] // remember all detected issues

    // if a third argument is provided (`node index.js <third argument>`), interpret it as the input file to use
    if (process.argv.length > 2) {
        this.inputStream = fs.createReadStream(process.argv[2]) // open the file as a read stream (error handling is done below)
    } else {
      this.inputStream = process.stdin // if no input file is provided, use stdin as the input. this allows for continuous live data
    }
    
    // `tshark` executable needs to be in PATH
    // '-i -': use interface 'pipe'
    // '-T json': output packet info as JSON
    // '-x': include raw packet data with output
    this.tshark = spawn(`tshark`, [`-i`, `-`, `-T`, `json`, `-x`])
    
    // pipes tshark's output into the stream array parser and assigns the pipe output to `this.packetPipeline`
    this.packetPipeline = this.tshark.stdout
      .pipe(StreamArray.withParser());

    // for some reason tshark outputs everything to stdout (at least if it starts with the error "The NPF driver isn't running.  You may have trouble capturing or listing interfaces.")
    // this error is irrelevant, because we aren't using any hardware as input, just the stdin pipe or a file
    this.tshark.stdout.on('data', (data) => {
      // console.log(`stdout: ${data}`)
    });

    // output stderr. also includes regular (non-error) output 
    this.tshark.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`)
    });

    // now that all other pipes and the handling is set up, pipe the input stream (file or stdin, in pcap(ng) format) into tshark
    this.inputStream.pipe(this.tshark.stdin)
    
    // every time the stream array parser parses a full packet, it outputs it to the pipeline
    // data.value is the actual packet, we don't need the rest
    this.packetPipeline.on('data', data => {

      try {
        
        // console.debug(data.value)
        let packet = new Packet(data.value) // parse the raw JSON-packet into a more useful Packet-instance
        this.packetBuffer.push(packet) // save the parsed packet
        this.emit(`packet`, packet) // notify the consumer about the new packet

        // some packages can be malformed
        // they might have been only partially sniffed, or they broke protocol
        // create an issue of type error if this happens
        if (packet.info.malformed) {
          this.createIssue({
            type: `alert`,
            microseconds: packet.info.microseconds,
            message: `Packet seems to be malformed!`,
          })
        }

        // some packets have a bad CRC
        // this could indicates accidental or deliberate interference, or just an incomplete sniff
        // create an issue of type warning if this happens 
        if (!packet.info.crcOk) {
          this.createIssue({
            type: `warning`,
            microseconds: packet.info.microseconds,
            message: `Packet CRC seems to be incorrect!`,
          })
        }
        
        let connection = packet.getConnectionInfo() // get the relevant info about the packet's connection properties for further analysis

        // if the packet is not related to any connection, `Packet.getConnectionInfo()` returns `undefined`, which is a falsy value
        // so only analyze the connection info, if it actually exists
        if (connection) {
          this.handleConnectionPackets(packet, connection) // analyze the connection info. method works in-place, so it directly modifies the classes properties, like `this.connections`
        }
        
        // same as for handling connection info
        let advertiser = packet.getAdvertiserInfo()

        if (advertiser) {
          this.handleAdvertisingPackets(packet, advertiser)
        }

      } catch (err) {
        console.error(`Error while parsing packet:`, err)
      }
      
    });
    
    // only emitted if a file is used as input, after the complete file has been parsed and `this.inputStream` closed
    this.packetPipeline.on(`close`, () => {

      console.log(`Parsed all packets!`)
      this.emit(`end`) // notify the consumer about the end of the pipeline

    })
    
  }

  /**
   * ### Analyzes a packet's connection info and takes appropriate action  
   * If the packet is either a) the beginning of a connection, b) part of a connection or c) the end of a connection, use this method to handle it  
   * @param {Packet} packet the complete packet to which the connection info belongs
   * @param {Object} connection the connection info object to analyze
   */
  handleConnectionPackets(packet, connection) {

    // a connection info object can have three different states 
    switch (connection.state) {
      // if a packet marks the beginning of a connection (like a CONNECT_IND), handle it here
      case `start`:
        
        console.debug(`++connectionStartCounter:`, ++connectionStartCounter)

        console.debug(`connection.properties:`, connection.properties)
        
        // if the connection is already known (there is an entry in `this.connections` for this access address)
        if (this.connections.has(connection.accessAddress)) {

          // get the existing connection
          let existingConnection = this.connections.get(connection.accessAddress)
          console.debug(`Old connection:`, oldConnection)
          console.debug(`New connection:`, connection)

          // check if the existing connection is active (not ended, not still in start (being set up))
          // if it is, we probably missed the end or timeout, so we just load the packet counts from the existing connection and add them to the new connection with the new properties
          if (existingConnection.state === `active`) {

            console.warn(`Beginning of connection detected even though connection is active! Adding old packets...`)

            connection.packets += existingConnection.packets // maybe only the connection properties changed, so we want to remember all previous packets as well
            connection.distribution.M2S += existingConnection.distribution.M2S // remember the old packet distribution
            connection.distribution.S2M += existingConnection.distribution.S2M // remember the old packet distribution

            // we are missing some info (about the reason for the connection restart), so create an issue
            this.createIssue({
              type: `warning`,
              microseconds: connection.microseconds,
              message: `[${connection.accessAddress}] Master seems to be trying to reconnect!`,
            })

          } else if (existingConnection.state === `end`) {
            // handle this exactly the same as an active existing connection for now, so sum up the old packets and use the new properties

            onsole.warn(`Beginning of connection detected even though there was a connection before! Adding old packets...`)

            connection.packets += existingConnection.packets // maybe only the connection properties changed, so we want to remember all previous packets as well
            connection.distribution.M2S += existingConnection.distribution.M2S // remember the old packet distribution
            connection.distribution.S2M += existingConnection.distribution.S2M // remember the old packet distribution

            // we are missing some info (about the reason for the connection restart), so create an issue
            this.createIssue({
              type: `warning`,
              microseconds: connection.microseconds,
              message: `[${connection.accessAddress}] Connection seems to have started again!`,
            })
            
          } else {
            // if the existing connection was still starting, we don't need its info anymore (properties are outdated, and there were no packets sent yet)
            console.warn(`Beginning of connection detected, connection exists but isn't active! Overwriting...`)
          }

        }

        // replace the existing connection with the new connection (might include old packets)
        this.connections.set(connection.accessAddress, connection)

        this.emit(`new-connection`, [...this.connections.values()]) // notify the consumer about the new connection (and include all other connections for convenience)
      
        break;

      // if a packet marks the end of a connection, handle it here
      case `end`:

        console.debug(`++connectionEndCounter:`, ++connectionEndCounter)

        // optional 'info' issue, not used so far
        // this.createIssue({
        //   type: `info`,
        //   microseconds: connection.microseconds,
        //   message: `[${connection.accessAddress}] Connection seems to have ended!`,
        // })

        // if the connection already exists, all is well
        // just update the state
        if (this.connections.has(connection.accessAddress)) {

          let existingConnection = this.connections.get(connection.accessAddress) // load the existing connection
          existingConnection.state = connection.state // update the state of the existing connection

          // this only applies to frames within a connection event, which sadly don't seem to be exposed/exported by tshark/Wireshark
          // if (existingConnection.packets % 2 !== 0) {
          //   this.createIssue({
          //     type: `warning`,
          //     microseconds: connection.microseconds,
          //     message: `[${connection.accessAddress}] Odd number of connection events before end of connection!`,
          //   })
          // }
          
        } else {
          // if the connection has ended but we don't know that connection, just ignore it
          console.error(`End of connection detected but connection doesn't exists yet! Ignoring...`, packet)
        }
      
        break;
    
      default: // `active`, packet is a normal packet that's part of a connection, handle it here

        // if the packet is part of a connection, the connection *should* exist...
        if (this.connections.has(connection.accessAddress)) {

          // console.debug(`++connectionPacketCounter:`, ++connectionPacketCounter)
  
          // load the existing connection
          let existingConnection = this.connections.get(connection.accessAddress)
  
          // check if there was a previous packet from the slave at all. the timestamp/microseconds could be `NaN`, if we didn't detect/sniff the start of the connection
          if (!isNaN(existingConnection.lastPackets[`S2M`])) {
  
            // calculate the time between this packet and the previous packet from the slave
            let timeSinceLastSlavePacket = (connection.microseconds - existingConnection.lastPackets[`S2M`])

            // check if slave has timed out (connection might not be lost yet)
            // latency + 1 because the latency can be set to 0 to disallow skipping intervals
            if (existingConnection.properties.connectionInterval * 1250 * (existingConnection.properties.slaveLatency + 1) < timeSinceLastSlavePacket) {
  
              // check if the supervision timeout has been exceeded, if yes, create an issue of type alert
              if (existingConnection.properties.supervisionTimeout * 10000 < timeSinceLastSlavePacket) {
                this.createIssue({
                  type: `alert`,
                  microseconds: connection.microseconds,
                  message: `[${connection.accessAddress}] Connection seems to be lost!`,
                })
              } else {
                // if the supervision timeout hasn't been exceeded, but the slave skipped a connection event
                // disabled because it's a bit too verbose
  
                // this.createIssue({
                //   type: `warning`,
                //   microseconds: connection.microseconds,
                //   message: `[${connection.accessAddress}] Slave has timed out!`,
                // })
              }
  
            }
  
          }
          
          // update the connection state and add a packet
          existingConnection.state = `active`
          existingConnection.packets += 1
          existingConnection.distribution[connection.direction] += 1
          existingConnection.lastPackets[connection.direction] = connection.microseconds
  
        } else {
          // if the packet is part of a connection, but we don't know the connection yet, we have to create it and start recording packets, even though we don't know the properties

          console.warn(`Connection packet detected but connection doesn't exist yet! Creating connection...`)
          console.debug(`packet.info.packetId:`, packet.info.packetId)
  
          this.createIssue({
            type: `warning`,
            microseconds: connection.microseconds,
            message: `[${connection.accessAddress}] Connection packet detected, but didn't detect the beginning of the connection!`,
          })
          
          // get as much information about the connection as we can and add placeholder properties for the rest
          let enrichedConnection = packet.enrichConnectionInfo(connection)
          
          // the connection won't have connection properties until it is restarted while sniffing, so timeouts can't be checked
          // there might also be some packets that are currently treated like being part of a connection, even though they aren't really
          // those packets will also start a connection for now
          this.connections.set(connection.accessAddress, enrichedConnection)
          this.emit(`new-connection`, [...this.connections.values()]) // notify the consumer about the new connection (and include all other connections for convenience)
          
        }
      
        break;
    }
        
  }

  /**
   * ### Analyzes a packet's advertiser info and takes appropriate action  
   * @param {Packet} packet the complete packet to which the advertiser info belongs
   * @param {Object} advertiser the advertiser info object to analyze
   */
  handleAdvertisingPackets(packet, advertiser) {

    // if the advertiser with this advertising address is already known
    if (this.advertisers.has(advertiser.advertisingAddress)) {

      // load the existing advertiser
      let existingAdvertiser = this.advertisers.get(advertiser.advertisingAddress)

      // if the packet is a regular advertisement, simply increase the packet count
      if (packet.info.isPrimaryAdvertisement) {
        existingAdvertiser.packets += 1
      }
      // if the advertiser info contains a complete local name, add id to the advertiser's properties and overwrite the previous name (if any)
      if (advertiser.completeLocalName) {
        existingAdvertiser.completeLocalName = advertiser.completeLocalName
      }

      // if the advertiser info contains a shortened local name, add id to the advertiser's properties and overwrite the previous name (if any)
      if (advertiser.shortLocalName) {
        existingAdvertiser.shortLocalName = advertiser.shortLocalName
      }
      
    } else {
      // if no advertiser with this advertising address exists yet

      // if the packet is a regular advertisement, create a new advertiser and set its packet count to 1
      if (packet.info.isPrimaryAdvertisement) {

        advertiser.packets = 1;
        this.advertisers.set(advertiser.advertisingAddress, advertiser) // create the advertiser, local names are already included (if provided)
        this.emit(`new-advertiser`, [...this.advertisers.values()]) // notify the consumer about the new advertiser (and include all other known advertisers for convenience)
        
      }

    }
    
  }

  /**
   * ### Creates a new issue and re-emits all issues
   * Includes *all* existing issues right now, causing all issues to be broadcasted to all clients anytime there's a new issue. This might have to be changed if there are a lot of issues or clients.
   * @param {Object} properties 
   * @param {Number} properties.microseconds The microseconds (epoch) when the issue occurred
   * @param {String} properties.type The type of the issue (warning, alert)
   * @param {String} properties.message A description of the issue
   */
  createIssue(properties) {

    this.issues.push(properties) // add the provided issue object to the issues array
    this.emit(`new-issue`, this.issues) // notify the consumer about the new issues (and include all other issues for convenience)

  }
  
}
