module.exports = class Packet {

  constructor(originalPacket) {

    this.originalPacket = originalPacket
    
    try {
      this.info = this.getPacketInfo(originalPacket)
    } catch (err) {
      console.error(`Error while extracting packet this.info:`, err)
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
      packetId: this.info.packetId,
      microseconds: this.info.microseconds,
      channel: this.info.channel,
      rssi: this.info.rssi,
      payload: this.info.payload,
      isAdvertisement: this.info.isAdvertisement,
      isPartOfConnection: this.info.connection.isPartOfConnection,
      accessAddress: this.info.connection.accessAddress,
      type: this.info.type,
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
      return {
        accessAddress: this.info.connection.properties.accessAddress,
        state: `start`,
        master: this.info.connection.master,
        slave: this.info.connection.slave,
        properties: this.info.connection.properties,
        packets: 0,
        distribution: {
          M2S: 0,
          S2M: 0,
        },
        lastPackets: {
          M2S: this.info.microseconds,
          S2M: this.info.microseconds,
        },
      }
    }

    if (this.info.connection.isEndOfConnection) {
      return {
        accessAddress: this.info.connection.properties.accessAddress,
        state: `end`,
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

  getAdvertisementInfo() {

    return !this.info.isAdvertisement ? false : {
      advertisingAddress: this.info.advertisingAddress,
    }
    
  }

  getPacketInfo(originalPacket) {

    //TODO first determine type, then source & destination
  
    const primaryAdvertisingChannels = [37, 38, 39]
    
    let layers = originalPacket._source.layers
    let malformed
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
    let isAdvertisement = false
    let isOnPrimaryAdvertisingChannel = false
    let advertisingAddress
    let connectionProperties = {}
  
    malformed = layers[`_ws.malformed`] !== undefined
    channel = parseInt(layers.nordic_ble[`nordic_ble.channel`])
    isOnPrimaryAdvertisingChannel = [37, 38, 39].includes(channel)
    rssi = layers.nordic_ble[`nordic_ble.rssi`]
    payload = layers.frame_raw[0]
    packetId = parseInt(layers.frame[`frame.number`])
    microseconds = parseInt(layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``))
    length = parseInt(layers.frame[`frame.len`])
    advertisingAddress = layers.btle[`btle.advertising_address`]
  


    if (layers.btle[`btle.advertising_header`]) {
  
      switch (parseInt(layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`].slice(-2), 16)) {
        case 0:
          type = `ADV_IND`
          isAdvertisement = true
          break;
        case 1:
          type = `ADV_DIRECT_IND`
          isAdvertisement = true
          break;
        case 2:
          type = `ADV_NONCONN_IND`
          isAdvertisement = true
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
          isAdvertisement = true
          break;
        case 8:
          type = `AUX_CONNECT_RSP`
          break;
      
        default:
          type = `unknown`
          break;
      }
      
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
    
    //TODO check if compatible with CONNECT_IND
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
      //TODO source for non-connection, non-advertising packets?
    }
    
    // determine destination
    if (isPartOfConnection) {
      destination = direction === `S2M` ? layers.btle[`btle.master_bd_addr`] : layers.btle[`btle.slave_bd_addr`]
    } else {
      //TODO destinations for non-connection packets?
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
            crc: layers.btle[`btle.crc`],
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
  
    //TODO prevent errors by checking if key exists
  
    return {
      malformed,
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
      isAdvertisement,
      isOnPrimaryAdvertisingChannel,
      advertisingAddress,
      protocols,
      llid,
      length,
    }
    
  }
  
}
