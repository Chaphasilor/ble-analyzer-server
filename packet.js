module.exports = class Packet {

  /**
   * ### Parses a raw packet into a Packet object
   * @param {Object} originalPacket the raw JSON-packet generated by tshark
   */
  constructor(originalPacket) {

    // remember the raw packet data for future reference
    this.originalPacket = originalPacket
    
    try {
      // parse the packet and remember the results
      this.info = this.getPacketInfo(originalPacket)
    } catch (err) {
      console.error(`Error while extracting packet info:`, err)
    }
    
  }

  /**
   * @returns {Object} the raw packet data
   */
  getRawInfo() {

    return this.originalPacket

  }

  /**
   * ### Generate more or less detailed info about the packet
   * @param {String} format the packet format to return
   * @returns info about the packet, in the specified format
   */
  getInfo(format) {

    switch (format) {
      case `full`:
        return this.getFullInfo()
      case `raw`:
        return this.getRawInfo()
      default: // simple format
        return this.getSimpleInfo()
    }
    
  }

  /**
   * @returns all available info about the packet
   */
  getFullInfo() {

    return {...this.info, // returns all available info
        // and possibly some custom additional info (just add additional keys to the object)
    }
    
  }

  /**
   * ### Generates less-detailed info about the packet 
   * @returns the most commonly need info about the packet
   */
  getSimpleInfo() {

    return {
      malformed: this.info.malformed,
      crcOk: this.info.crcOk,
      packetId: this.info.packetId,
      microseconds: this.info.microseconds,
      channel: this.info.channel,
      rssi: this.info.rssi,
      payload: this.info.payload,
      isAdvertisement: this.info.isPrimaryAdvertisement,
      isPartOfConnection: this.info.connection.isPartOfConnection,
      accessAddress: this.info.connection.accessAddress,
      type: this.info.type === `unknown` ? this.info.llid : this.info.type, // if we don't know the PDU type, maybe we at least recognize the LLID type
      advertisingAddress: this.info.advertisingAddress,
      source: this.info.source,
      destination: this.info.destination,
      protocols: this.info.protocols.map(protocol => protocol.name),
      length: this.info.length,
      // returns the first match from a sorted protocol list/ranking
      highestProtocol: [`btatt`, `btsmp`, `btl2cap`, `btle`, `nordic_ble`].find(proto => {
        return this.info.protocols.map(x => x.shortName).includes(proto) 
      })
    }
    
  }

  /**
   * ### Generates information about the packet's connection
   * @returns info about connections the packet is part of
   */
  getConnectionInfo() {

    if (this.info.connection.isBeginningOfConnection) {
      // enrich the connection info to include all fields without being too verbose
      return this.enrichConnectionInfo({
        accessAddress: this.info.connection.properties.accessAddress,
        state: `start`,
        microseconds: this.info.microseconds,
      })
    }

    if (this.info.connection.isEndOfConnection) {
      return {
        accessAddress: this.info.connection.accessAddress,
        state: `end`,
        microseconds: this.info.microseconds,
      }
    }
    
    if (this.info.connection.isPartOfConnection) {
      // if the packet is part of a connection (not the start or end of it), we include more specific info instead of enriching it
      return {
        accessAddress: this.info.connection.accessAddress,
        state: `active`,
        master: this.info.connection.master,
        slave: this.info.connection.slave,
        direction: this.info.direction,
        microseconds: this.info.microseconds,
      }
    }
    
    return false
    
  }

  /**
   * ### Adds additional info about the packet's connection to an existing connection object
   * @param {Object} connection some basic connection info (state, microseconds, access address)
   * @returns the enriched connection
   */
  enrichConnectionInfo(connection) {

    return {
      ...connection,
      master: this.info.connection.master,
      slave: this.info.connection.slave,
      properties: this.info.connection.properties,
      packets: this.info.connection.isPartOfConnection ? 1 : 0,
      // if we enrich a packet that's part of a connection, we check the direction and increase the respective packet count...
      distribution: {
        M2S: (this.info.connection.isPartOfConnection && this.info.direction === `M2S`) ? 1 : 0,
        S2M: (this.info.connection.isPartOfConnection && this.info.direction === `S2M`) ? 1 : 0,
      },
      // ...and we also remember the microseconds of the previous packet for that direction
      // one of the directions will have `NaN` as `microseconds`, this is handles in parse.js
      lastPackets: {
        M2S: this.info.connection.isPartOfConnection ? this.info.direction === `M2S` ? this.info.microseconds : NaN : this.info.microseconds,
        S2M: this.info.connection.isPartOfConnection ? this.info.direction === `S2M` ? this.info.microseconds : NaN : this.info.microseconds,
      },
    }
    
  }

  /**
   * ### Generates info about the packet's advertiser
   * @returns info about the advertiser behind the packet
   */
  getAdvertiserInfo() {

    // primary advertisements don't include most advertising data, so handle both
    return !(this.info.isPrimaryAdvertisement || this.info.advertisingData) ? false : {
      advertisingAddress: this.info.advertisingAddress,
      shortLocalName: this.info.advertisingData.find(entry => entry.type === `0x08`)?.value,
      completeLocalName: this.info.advertisingData.find(entry => entry.type === `0x09`)?.value,
    }
    
  }

  /**
   * ### Extracts relevant information about a packet
   * This information is used for further analysis of the packets.  
   * The method is called when constructing a new packet and shouldn't be called again afterwards.  
   * The results are available as `this.info`
   * @param {Object} originalPacket the raw packet data
   * @returns all info that could be extracted from the raw data
   */
  getPacketInfo(originalPacket) {

    // initialize variables
    const primaryAdvertisingChannels = [37, 38, 39]
    
    let layers = originalPacket._source.layers
    let malformed
    let crcOk
    let source = ``, destination = ``
    let type = `unknown`
    let llid = `unknown`
    let opCode = `unknown`
    let direction = `unknown`
    let accessAddress
    let isPartOfConnection = false
    let isBeginningOfConnection = false
    let isEndOfConnection = false
    let master = ``, slave = ``
    let channel
    let rssi
    let payload
    let packetId
    let microseconds
    let length
    let protocols
    let isPrimaryAdvertisement = false
    let isOnPrimaryAdvertisingChannel = false
    let advertisingAddress
    let connectionProperties = {}
    let advertisingData = []
    // let scanResponseAdvertisingData = []
  
    // extract basic information
    malformed = layers[`_ws.malformed`] !== undefined
    crcOk = parseInt(layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.crcok`]) === 1
    channel = parseInt(layers.nordic_ble[`nordic_ble.channel`])
    isOnPrimaryAdvertisingChannel = [37, 38, 39].includes(channel)
    rssi = layers.nordic_ble[`nordic_ble.rssi`]
    payload = layers.frame_raw[0]
    packetId = parseInt(layers.frame[`frame.number`])
    microseconds = parseInt(layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``))
    length = parseInt(layers.frame[`frame.len`])
    advertisingAddress = layers.btle[`btle.advertising_address`]
  


    // if there is an advertising header, extract the packet (PDU) type from it as well as the advertising type
    // auxiliary PDU types use secondary advertising (data) channels, those channels are defined at the top
    if (layers.btle[`btle.advertising_header`]) {
  
      switch (parseInt(layers.btle[`btle.advertising_header_tree`]?.[`btle.advertising_header.pdu_type`]?.slice(-2), 16)) {
        case 0:
          type = `ADV_IND`
          isPrimaryAdvertisement = true
          break;
        case 1:
          type = `ADV_DIRECT_IND`
          isPrimaryAdvertisement = true
          break;
        case 2:
          type = `ADV_NONCONN_IND`
          isPrimaryAdvertisement = true
          break;
        case 3:
          type = primaryAdvertisingChannels.includes(channel) ? `SCAN_REQ` : `AUX_SCAN_REQ`
          break;
        case 4:
          type = `SCAN_RSP`
          break;
        case 5:
          type = primaryAdvertisingChannels.includes(channel) ? `CONNECT_IND` : `AUX_CONNECT_REQ`
          break;
        case 6:
          type = `ADV_SCAN_IND`
          break;
        case 7:
          type = primaryAdvertisingChannels.includes(channel) ? `ADV_EXT_IND` : `AUX_ADV_IND` // or `AUX_SCAN_RSP`, `AUX_SYNC_IND`, `AUX_CHAIN_IND`, no idea how to detect those
          isPrimaryAdvertisement = true
          break;
        case 8:
          type = `AUX_CONNECT_RSP`
          break;
      
        default:
          type = `unknown`
          break;
      }
      
    }

    /**
     * ### Parses an advertising data byte string into advertising entries
     * The parsed entries are added to the `advertisingData` array
     * Yes, this is a 'method' within a method. Welcome to JavaScript ¯\_(ツ)_/¯
     * @param {String} bytesToParse the hex string of bytes to parse, without `0x` in front
     * @returns `undefined`. no return value, method works in-place
     */
    let parseAdvertisingData = (bytesToParse) => {

      if (!bytesToParse) {
        return
      }

      let remainingBytes = bytesToParse

      while (remainingBytes.length > 0) {

        // take the first two bytes and parse them into a number
        // this is the length of entry type + entry value, excluding the two bytes for the length
        let entryLength = parseInt(`0x${remainingBytes.slice(0, 2)}`)

        // create the basic entry 
        // the type is upper-case hex (except for the `x` of course). could be changed to a parsed number instead for increased robustness
        let entry = {
          type: `0x${remainingBytes.slice(2, 4).toUpperCase()}`, // type is always two octets/bytes
          value: `0x${remainingBytes.slice(2 + 2, (2 + 2) + entryLength*2 - 2)}`, // add offset, exclude length of type
          length: entryLength,
        }

        // console.debug(`remainingBytes:`, remainingBytes)
        // console.debug(`entry.length:`, entry.length)
        // console.debug(`entry.type:`, entry.type)
        // console.debug(`entry.value:`, entry.value)
        
        // assign the correct name to each type
        // data taken from https://www.bluetooth.com/specifications/assigned-numbers/generic-access-profile/
        switch (entry.type) {
          case `0x01`:
            entry.name = `Flags`
            break;
          case `0x02`:
            entry.name = `Incomplete List of 16-bit Service Class UUIDs`
            break;
          case `0x03`:
            entry.name = `Complete List of 16-bit Service Class UUID`
            break;
          case `0x04`:
            entry.name = `Incomplete List of 32-bit Service Class UUIDs`
            break;
          case `0x05`:
            entry.name = `Complete List of 32-bit Service Class UUIDs`
            break;
          case `0x06`:
            entry.name = `Incomplete List of 128-bit Service Class UUIDs`
            break;
          case `0x07`:
            entry.name = `Complete List of 128-bit Service Class UUIDs`
            break;
          case `0x08`:
            entry.name = `Shortened Local Name`
            entry.value = hexStringToAscii(entry.value) // hex value represents an ASCII string, which is more useful when parsed ^^
            break;
          case `0x09`:
            entry.name = `Complete Local Name`
            entry.value = hexStringToAscii(entry.value) // hex value represents an ASCII string, which is more useful when parsed ^^
            break;
          case `0x0A`:
            entry.name = `Tx Power Level`
            break;
          case `0x0D`:
            entry.name = `Class of Device`
            break;
          case `0x0E`:
            entry.name = `Simple Pairing Hash C`
            break;
          case `0x0E`:
            entry.name = `Simple Pairing Hash C-192`
            break;
          case `0x0F`:
            entry.name = `Simple Pairing Randomizer R`
            break;
          case `0x0F`:
            entry.name = `Simple Pairing Randomizer R-192`
            break;
          case `0x10`:
            entry.name = `Device ID`
            break;
          case `0x11`:
            entry.name = `Security Manager Out of Band Flags`
            break;
          case `0x12`:
            entry.name = `Slave Connection Interval Range`
            break;
          case `0x14`:
            entry.name = `List of 16-bit Service Solicitation UUIDs`
            break;
          case `0x15`:
            entry.name = `List of 128-bit Service Solicitation UUIDs`
            break;
          case `0x16`:
            entry.name = `Service Data`
            break;
          case `0x16`:
            entry.name = `Service Data - 16-bit UUID`
            break;
          case `0x17`:
            entry.name = `Public Target Address`
            break;
          case `0x18`:
            entry.name = `Random Target Address`
            break;
          case `0x19`:
            entry.name = `Appearance`
            break;
          case `0x1A`:
            entry.name = `Advertising Interval`
            break;
          case `0x1B`:
            entry.name = `LE Bluetooth Device Address`
            break;
          case `0x1C`:
            entry.name = `LE Role`
            break;
          case `0x1D`:
            entry.name = `Simple Pairing Hash C-256`
            break;
          case `0x1E`:
            entry.name = `Simple Pairing Randomizer R-256`
            break;
          case `0x1F`:
            entry.name = `List of 32-bit Service Solicitation UUIDs`
            break;
          case `0x20`:
            entry.name = `Service Data - 32-bit UUID`
            break;
          case `0x21`:
            entry.name = `Service Data - 128-bit UUID`
            break;
          case `0x22`:
            entry.name = `LE Secure Connections Confirmation Value`
            break;
          case `0x23`:
            entry.name = `LE Secure Connections Random Value`
            break;
          case `0x24`:
            entry.name = `URI`
            break;
          case `0x25`:
            entry.name = `Indoor Positioning`
            break;
          case `0x26`:
            entry.name = `Transport Discovery Data`
            break;
          case `0x27`:
            entry.name = `LE Supported Features`
            break;
          case `0x28`:
            entry.name = `Channel Map Update Indication`
            break;
          case `0x29`:
            entry.name = `PB-ADV`
            break;
          case `0x2A`:
            entry.name = `Mesh Message`
            break;
          case `0x2B`:
            entry.name = `Mesh Beacon`
            break;
          case `0x2C`:
            entry.name = `BIGInfo`
            break;
          case `0x2D`:
            entry.name = `Broadcast_Code`
            break;
          case `0x3D`:
            entry.name = `3D Information Data`
            break;
          case `0xFF`:
            entry.name = `Manufacturer Specific Data`
            break;
        
          default:
            entry.name = `unknown`
            break;
        }

        // add the new entry to the array
        advertisingData.push(entry)

        // remove the parsed bytes from the remaining bytes
        remainingBytes = remainingBytes.slice(2 + entryLength*2) // 2 octets for length + length* 2 octets
        
      }
      
    }

    // tshark doesn't parse advertising data for us, so we have to do it manually :(
    if (type === `ADV_IND`) {
      // if the packet is an advertising indication, it should contain advertising data

      parseAdvertisingData(layers.btle[`btcommon.eir_ad.advertising_data_raw`][0])
      
    } else if (type === `SCAN_RSP`) {
      // if the packet is a scan response, it should also contain advertising data, but at a different JSON-path

      parseAdvertisingData(layers.btle[`btle.scan_responce_data_tree`]?./* typo in tshark? */[`btcommon.eir_ad.advertising_data_raw`][0])
      
    }

    // extract info from the data header
    if (layers.btle[`btle.data_header`]) {

      // extract the LLID as a number, detect the LLID type and in some cases also the opcode
      // mostly needed to detect end of connections
      // couldn't be bothered to include more types...
      switch (parseInt(layers.btle[`btle.data_header_tree`][`btle.data_header.llid`])) {
        case 3: // Control PDU
          
          llid = `Control PDU`
        
          switch (parseInt(layers.btle[`btle.control_opcode`])) {
            case 2:
              opCode = `LL_TERMINATE_IND`
              break;
          
            default:
              break;
          }
        
          break;
      
        default:
          break;
      }

    }

    isEndOfConnection = opCode === `LL_TERMINATE_IND`

    // extract the access address
    if (layers.btle[`btle.access_address`]) {
      accessAddress = layers.btle[`btle.access_address`]
    }
    
    // detect start of connections
    // might also work with `CONNECT_IND` packets, but not tested, didn't have the required data
    if ([`AUX_CONNECT_REQ`].includes(type)) {

      // extract basic connection info
      master = layers.btle[`btle.initiator_address`]
      slave = layers.btle[`btle.advertising_address`]
      direction = `M2S`
      isBeginningOfConnection = true

      // extract the access address again for the connection properties, just for good measure 
      connectionProperties.accessAddress = layers.btle[`btle.link_layer_data`][`btle.link_layer_data.access_address`]
      
      // extract all connection properties
      connectionProperties.crcInit = layers.btle[`btle.link_layer_data`][`btle.link_layer_data.crc_init`]
      connectionProperties.windowSize = parseInt(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.window_size`])
      // between 0 and connectionInterval, offset length = 1.25ms * offset
      connectionProperties.windowOffset = parseInt(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.window_offset`])
      // connection interval length = connectionInterval * 1.25ms
      connectionProperties.connectionInterval = parseInt(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.interval`])
      // the number of connection intervals the slave is allowed to ignore if it has no data to send. < 320
      connectionProperties.slaveLatency = parseFloat(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.latency`])
      // the time until a connection is considered lost. needs to be at least connection interval length + slave latency length. The timeout is 6? until the connection has been confirmed
      // timeout length = supervisionTimeout * 10ms
      connectionProperties.supervisionTimeout = parseFloat(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.timeout`])
      connectionProperties.channelHop = parseInt(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.hop`])
      connectionProperties.sleepClockAccuracy = layers.btle[`btle.link_layer_data`][`btle.link_layer_data.sleep_clock_accuracy`]

      // extract the channel map
      connectionProperties.channelMap = {}
      Object.entries(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.channel_map_tree`]).filter(([key, value]) => !key.includes(`raw`)).forEach(([key, value]) => connectionProperties.channelMap[key.split(`.`).slice(-1)] = value === `1`)

    }
  
    isPartOfConnection = accessAddress && accessAddress !== `0x8e89bed6` // filter out the advertising access address
  
    // detect basic connection info for packets inside a connection
    if (isPartOfConnection) {
      master = layers.btle[`btle.master_bd_addr`]
      slave = layers.btle[`btle.slave_bd_addr`]
      direction =  layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? `S2M` : `M2S`
    }
  
    // determine packet source
    if (
      layers.btle[`btle.scanning_address`] ||
      layers.btle[`btle.advertising_address`] ||
      layers.btle[`btle.initiator_address`] 
    ) {
  
      source = layers.btle[`btle.scanning_address`] || layers.btle[`btle.initiator_address`] ||
      layers.btle[`btle.advertising_address`] // the || is used as short-circuit, the first true-ish value is assigned
  
    } else if (isPartOfConnection) {
      
      // if the packet is part of a connection, we can simple use the direction info to determine the source
      source = direction === `S2M` ? layers.btle[`btle.slave_bd_addr`] : layers.btle[`btle.master_bd_addr`]
      
    } else {
      // non-connection, non-advertising packets shouldn't exist, right?
    }
    
    // determine destination
    if (isPartOfConnection) {
      destination = direction === `S2M` ? layers.btle[`btle.master_bd_addr`] : layers.btle[`btle.slave_bd_addr`]
    } else {
      // destination for non-connection packets is currently `undefined`, could also be set to something like `broadcast`
    }
  
    // detect various other information, depending on the protocols used
    protocols = layers.frame[`frame.protocols`].split(`:`).filter(x => x !== `btcommon`).map(protocolName => {
  
      switch (protocolName) {
        case `btle`:
          return {
            name: `BT LE Link Layer`,
            shortName: protocolName,
            length: layers.btle[`btle.length`],
            accessAddress: layers.btle[`btle.access_address`],
            // extract the header data to a simpler object
            header: layers.btle[`btle.advertising_header_tree`] ? Object.entries(layers.btle[`btle.advertising_header_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btle.advertising_header.`, ``)] = value
              return obj
            }, {}) : undefined,
            crc: layers.btle[`btle.crc`],
          }
          break;
      
        case `nordic_ble`:
          return {
            name: `Nordic BLE Sniffer`,
            shortName: protocolName,
            length: layers.nordic_ble[`nordic_ble.len`],
            boardId: layers.nordic_ble[`nordic_ble.board_id`],
            // extract the flags to an object
            flags: layers.nordic_ble[`nordic_ble.flags_tree`] ? Object.entries(layers.nordic_ble[`nordic_ble.flags_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`nordic_ble.`, ``)] = value
              return obj
            }, {}) : undefined,
            crcOk: parseInt(layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.crcok`]) === 1
          }
          break;
      
        case `btl2cap`:
          return {
            name: `L2CAP`,
            shortName: protocolName,
            length: Number(layers.btl2cap[`btl2cap.length`]),
            cid: Number(layers.btl2cap[`btl2cap.cid`]),
            payload: layers.btl2cap[`btl2cap.payload`]
          }
          break;
      
        case `btatt`:
          return {
            name: `ATT`,
            shortName: protocolName,
            startingHandle: layers.btatt[`btatt.starting_handle`],
            endingHandle: layers.btatt[`btatt.ending_handle`],
            // extract opcodes to an object
            opcode: layers.btatt[`btatt.opcode_tree`] ? Object.entries(layers.btatt[`btatt.opcode_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btatt.opcode.`, ``)] = value
              return obj
            }, {}) : undefined,
            uuid16: layers.btatt[`btatt.uuid16`],
          }
          break;
      
        case `btsmp`:
          return {
            name: `Security Manager`,
            shortName: protocolName,
            opcode: layers.btsmp[`btsmp.opcode`],
            ioCapability: layers.btsmp[`btsmp.io_capability`],
            oobDataFlags: layers.btsmp[`btsmp.oob_data_flags`],
            // extract the authentication request info into an object
            authReq: layers.btsmp[`btsmp.authreq_tree`] ? Object.entries(layers.btsmp[`btsmp.authreq_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btsmp.`, ``)] = value
              return obj
            }, {}) : undefined,
            maxEncryptionKeySize: layers.btsmp[`btsmp.max_enc_key_size`],
            // extract the initiator key distribution into an object            
            initiatorKeyDistribution: layers.btsmp[`btsmp.initiator_key_distribution_tree`] ? Object.entries(layers.btsmp[`btsmp.initiator_key_distribution_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btsmp.key_dist_`, ``)] = value
              return obj
            }, {}) : undefined,
            // extract the responder key distribution into an object              
            responderKeyDistribution: layers.btsmp[`btsmp.responder_key_distribution_tree`] ? Object.entries(layers.btsmp[`btsmp.responder_key_distribution_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btsmp.key_dist_`, ``)] = value
              return obj
            }, {}) : undefined,
            randomValue: layers.btsmp[`btsmp.random_value`],
            confirmValue: layers.btsmp[`btsmp.cfm_value`],
          }
          break;
  
        default:
          return {
            name: `<unknown protocol> (${protocolName})`,
            shortName: protocolName,
          }
          break;
      }
      
    })
  
    // return all the extracted information
    // don't forget to add new variables here after adding them above ^
    return {
      malformed,
      crcOk,
      packetId,
      microseconds,
      channel,
      rssi,
      payload,
      type,
      connection: {
        isPartOfConnection,
        isBeginningOfConnection,
        isEndOfConnection,
        accessAddress,
        master,
        slave,
        properties: connectionProperties,
      },
      direction,
      source,
      destination,
      isPrimaryAdvertisement,
      isOnPrimaryAdvertisingChannel,
      advertisingAddress,
      advertisingData,
      protocols,
      llid,
      length,
    }
    
  }
  
}

/**
 * ### Parse HEX to ASCII
 * @param {String} input a hex string, with or without leading `0x`
 * @returns {String} The corresponding ASCII-string
 */
function hexStringToAscii(input) {
  input = input.replace(`0x`, ``)
  return input.split(``).reduce((output, curr, index) => {
    return index % 2 === 0 ? output + String.fromCharCode(parseInt(input.slice(index, index + 2), 16)) : output
  }, ``)
}