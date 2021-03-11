module.exports = class Packet {

  constructor(originalPacket) {

    this.originalPacket = originalPacket
    
    try {
      this.info = this.getPacketInfo(originalPacket)
    } catch (err) {
      console.error(`Error while extracting packet info:`, err)
    }
    
  }

  getRawInfo() {

    return this.originalPacket

  }

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

  getFullInfo() {

    return {...this.info,

    }
    
  }

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
      type: this.info.type === `unknown` ? this.info.llid : this.info.type,
      advertisingAddress: this.info.advertisingAddress,
      source: this.info.source,
      destination: this.info.destination,
      protocols: this.info.protocols.map(protocol => protocol.name),
      length: this.info.length,
      highestProtocol: [`btatt`, `btsmp`, `btl2cap`, `btle`, `nordic_ble`].find(proto => {
        return this.info.protocols.map(x => x.shortName).includes(proto) 
      })
    }
    
  }

  getConnectionInfo() {

    if (this.info.connection.isBeginningOfConnection) {
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

  enrichConnectionInfo(connection) {

    return {
      ...connection,
      master: this.info.connection.master,
      slave: this.info.connection.slave,
      properties: this.info.connection.properties,
      packets: this.info.connection.isPartOfConnection ? 1 : 0,
      distribution: {
        M2S: (this.info.connection.isPartOfConnection && this.info.direction === `M2S`) ? 1 : 0,
        S2M: (this.info.connection.isPartOfConnection && this.info.direction === `S2M`) ? 1 : 0,
      },
      lastPackets: {
        M2S: this.info.connection.isPartOfConnection ? this.info.direction === `M2S` ? this.info.microseconds : NaN : this.info.microseconds,
        S2M: this.info.connection.isPartOfConnection ? this.info.direction === `S2M` ? this.info.microseconds : NaN : this.info.microseconds,
      },
    }
    
  }

  getAdvertisementInfo() {

    return !this.info.isPrimaryAdvertisement ? false : {
      advertisingAddress: this.info.advertisingAddress,
    }
    
  }

  getPacketInfo(originalPacket) {

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
          type = primaryAdvertisingChannels.includes(channel) ? `ADV_EXT_IND` : `AUX_ADV_IND` // or `AUX_SCAN_RSP`, `AUX_SYNC_IND`, `AUX_CHAIN_IND`
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

    let parseAdvertisingData = (bytesToParse) => {

      if (!bytesToParse) {
        return
      }

      let remainingBytes = bytesToParse

      while (remainingBytes.length > 0) {

        let entryLength = parseInt(`0x${remainingBytes.slice(0, 2)}`)
        let entry = {
          type: `0x${remainingBytes.slice(2, 4).toUpperCase()}`, // type is always two octets
          value: `0x${remainingBytes.slice(2 + 2, (2 + 2) + entryLength*2 - 2)}`, // add offset, exclude length of type
          length: entryLength,
        }

        // console.log(`remainingBytes:`, remainingBytes)
        // console.log(`entry.length:`, entry.length)
        // console.log(`entry.type:`, entry.type)
        // console.log(`entry.value:`, entry.value)
        
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
            entry.value = hexStringToAscii(entry.value)
            break;
          case `0x09`:
            entry.name = `Complete Local Name`
            entry.value = hexStringToAscii(entry.value)
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

        entry.name = entry.name
        advertisingData.push(entry)
        remainingBytes = remainingBytes.slice(2 + entryLength*2) // 2 octets for length + length* 2 octets
        
      }
      
    }

    if (type === `ADV_IND`) {

      parseAdvertisingData(layers.btle[`btcommon.eir_ad.advertising_data_raw`][0])
      
    } else if (type === `SCAN_RSP`) {

      parseAdvertisingData(layers.btle[`btle.scan_responce_data_tree`]?./* typo in tshark? */[`btcommon.eir_ad.advertising_data_raw`][0])

      // let advertisingEntry = layers.btle[`btle.scan_responce_data_tree`]?./* typo in tshark? */[`btcommon.eir_ad.advertising_data`]?.[`btcommon.eir_ad.entry`]

      // let deviceName = advertisingEntry?.[`btcommon.eir_ad.entry.device_name`]

      // if (advertisingEntry) {

      //   let parsedEntry = {
      //     type: parseInt(advertisingEntry[`btcommon.eir_ad.entry.type`]),
      //     name: `unknown`,
      //     value: undefined,
      //     length: parseInt(advertisingEntry[`btcommon.eir_ad.entry.length`]),
      //   }
        
      //   if (deviceName) {
      //     parsedEntry = {
      //       ...parsedEntry,
      //       name: `Complete Local Name`,
      //       value: deviceName,
      //     }
      //   }

      //   scanResponseAdvertisingData.push(parsedEntry)

      // }
      
    }

    if (layers.btle[`btle.data_header`]) {

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

    if (layers.btle[`btle.access_address`]) {
      accessAddress = layers.btle[`btle.access_address`]
    }
    
    // might also work with `CONNECT_IND` packets, but not tested
    if ([`AUX_CONNECT_REQ`].includes(type)) {

      master = layers.btle[`btle.initiator_address`]
      slave = layers.btle[`btle.advertising_address`]
      direction = `M2S`
      isBeginningOfConnection = true

      connectionProperties.accessAddress = layers.btle[`btle.link_layer_data`][`btle.link_layer_data.access_address`]
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

      connectionProperties.channelMap = {}
      Object.entries(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.channel_map_tree`]).filter(([key, value]) => !key.includes(`raw`)).forEach(([key, value]) => connectionProperties.channelMap[key.split(`.`).slice(-1)] = value === `1`)

      connectionProperties.channelHop = parseInt(layers.btle[`btle.link_layer_data`][`btle.link_layer_data.hop`])
      connectionProperties.sleepClockAccuracy = layers.btle[`btle.link_layer_data`][`btle.link_layer_data.sleep_clock_accuracy`]
      
    }
  
    isPartOfConnection = accessAddress && accessAddress !== `0x8e89bed6`
  
    if (isPartOfConnection) {
      
      master = layers.btle[`btle.master_bd_addr`]
      slave = layers.btle[`btle.slave_bd_addr`]
      direction =  layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? `S2M` : `M2S`
    }
  
    // determine source
    if (
      layers.btle[`btle.scanning_address`] ||
      layers.btle[`btle.advertising_address`] ||
      layers.btle[`btle.initiator_address`] 
    ) {
  
      source = layers.btle[`btle.scanning_address`] || layers.btle[`btle.initiator_address`] ||
      layers.btle[`btle.advertising_address`]
  
    } else if (isPartOfConnection) {
      
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
  
    protocols = layers.frame[`frame.protocols`].split(`:`).filter(x => x !== `btcommon`).map(protocolName => {
  
      switch (protocolName) {
        case `btle`:
          return {
            name: `BT LE Link Layer`,
            shortName: protocolName,
            length: layers.btle[`btle.length`],
            accessAddress: layers.btle[`btle.access_address`],
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
            authReq: layers.btsmp[`btsmp.authreq_tree`] ? Object.entries(layers.btsmp[`btsmp.authreq_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btsmp.`, ``)] = value
              return obj
            }, {}) : undefined,
            maxEncryptionKeySize: layers.btsmp[`btsmp.max_enc_key_size`],
            initiatorKeyDistribution: layers.btsmp[`btsmp.initiator_key_distribution_tree`] ? Object.entries(layers.btsmp[`btsmp.initiator_key_distribution_tree`]).reduce((obj, [key, value], index) => {
              obj[key.replace(`btsmp.key_dist_`, ``)] = value
              return obj
            }, {}) : undefined,
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

function hexStringToAscii(input) {
  input = input.replace(`0x`, ``)
  return input.split(``).reduce((output, curr, index) => {
    return index % 2 === 0 ? output + String.fromCharCode(parseInt(input.slice(index, index + 2), 16)) : output
  }, ``)
}