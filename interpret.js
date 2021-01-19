function packet(originalPacket, format) {

  try {

    let info = getPacketInfo(originalPacket)

    switch (format) {
      case `full`:

        // return originalPacket._source
        return {...info,

        }

      default: // simple format

        return {
          malformed: info.malformed,
          packetId: info.packetId,
          microseconds: info.microseconds,
          isPartOfConnection: info.connection.isPartOfConnection,
          accessAddress: info.connection.accessAddress ,
          source: info.source,
          destination: info.destination,
          protocols: info.protocols.map(protocol => protocol.name),
          length: info.length,
        }
      
    }
    
  } catch (err) {
    console.error(`Error while extracting packet info:`, err)
  }
  
}
module.exports.packet = packet

function connection(originalPacket) {

  try {
    
    let info = getPacketInfo(originalPacket)
    
    return !info.connection.isPartOfConnection ? false : {
      accessAddress: info.connection.accessAddress,
      master: info.connection.master,
      slave: info.connection.slave,
    } 
    
  } catch (err) {
    console.error(`Error while extracting packet info:`, err);
  }
  
}
module.exports.connection = connection

function getPacketInfo(originalPacket) {

  //TODO first determine type, then source & destination

  let layers = originalPacket._source.layers
  let source = {}, destination = {}
  let packetType = `unknown`
  let accessAddress
  let isPartOfConnection

  //TODO make sure all advertising packets (accessAddress 0x8e89bed6 should be the standard one) are not treated as a connection
  if (layers.btle[`btle.advertising_header`]) {

    switch (layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {
      case `0x00000000`:
        packetType = `advertising`
        break;
      case `0x00000001`:
        packetType = `advertising`
        break;
      case `0x00000002`:
        packetType = `advertising`
        break;
      case `0x00000006`:
        packetType = `advertising`
        break;
      case `0x00000007`:
        packetType = `advertising`
        break;
    
      default:
        packetType = `unknown`
        break;
    }
    
  }

  if (layers.btle[`btle.access_address`]) {
    accessAddress = layers.btle[`btle.access_address`]
  }

  isPartOfConnection = packetType !== `advertising` && accessAddress !== `0x8e89bed6`

  // determine source
  if (
    layers.btle[`btle.scanning_address`] ||
    layers.btle[`btle.advertising_address`] ||
    layers.btle[`btle.initiator_address`] 
  ) {

    source = layers.btle[`btle.scanning_address`] || layers.btle[`btle.initiator_address`] ||
    layers.btle[`btle.advertising_address`]

  } else {
    
    source = layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? layers.btle[`btle.slave_bd_addr`] : layers.btle[`btle.master_bd_addr`]
    
  }
  
  // determine destination
  if (
    layers.btle[`btle.master_bd_addr`] ||
    layers.btle[`btle.slave_bd_addr`]
  ) {

    destination.type = `direct`

    destination.address = layers.nordic_ble[`nordic_ble.flags_tree`][`nordic_ble.direction`] == "0" ? layers.btle[`btle.master_bd_addr`] : layers.btle[`btle.slave_bd_addr`]
      
  } else if (layers.btle[`btle.advertising_header`] && layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {

    switch (layers.btle[`btle.advertising_header_tree`][`btle.advertising_header.pdu_type`]) {
      case `0x00000005`:
        destination.type = `connect_req`
        destination.address = layers.btle[`btle.advertising_address`]
        break;
      case `0x00000003`:
        destination.type = `scan_req`
        destination.address = layers.btle[`btle.advertising_address`]
        break;
    
      default:
        destination.type = `broadcast`
        break;
    }

    
  } else {
    destination.type = `broadcast`
  }

  //TODO prevent errors by checking if key exists

  return {
    malformed: layers[`_ws.malformed`] !== undefined,
    packetId: Number(layers.frame[`frame.number`]),
    microseconds: Number(layers.frame[`frame.time_epoch`].slice(0, -3).split(`.`).join(``)),
    channel: Number(layers.nordic_ble[`nordic_ble.channel`]),
    connection: {
      isPartOfConnection,
      accessAddress,
      master: layers.btle[`btle.master_bd_addr`],
      slave: layers.btle[`btle.slave_bd_addr`],
    },
    source,
    destination,
    protocols: layers.frame[`frame.protocols`].split(`:`).filter(x => x !== `btcommon`).map(protocolName => {

      switch (protocolName) {
        case `btle`:
          return {
            name: `BT LE Link Layer`,
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
            length: Number(layers.btl2cap[`btl2cap.length`]),
            cid: Number(layers.btl2cap[`btl2cap.cid`]),
            payload: layers.btl2cap[`btl2cap.payload`]
          }
          break;
      
        case `btatt`:
          return {
            name: `ATT`,
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
            name: `<unknown protocol> (${protocolName})`
          }
          break;
      }
      
    }),
    length: Number(layers.frame[`frame.len`]),
  }
  
}