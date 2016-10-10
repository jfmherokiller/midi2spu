"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var MidiHeader = (function () {
    function MidiHeader(formatype, trackCount, ticksPerBeat) {
        this.formatType = formatype;
        this.trackCount = trackCount;
        this.ticksPerBeat = ticksPerBeat;
    }
    return MidiHeader;
}());
var Chunk = (function () {
    function Chunk(newid, newlength, newdata) {
        this.id = newid;
        this.length = newlength;
        this.data = newdata;
    }
    return Chunk;
}());
var Event = (function () {
    function Event() {
    }
    return Event;
}());
var MetaEvent = (function (_super) {
    __extends(MetaEvent, _super);
    function MetaEvent() {
        _super.apply(this, arguments);
    }
    return MetaEvent;
}(Event));
var ChannelEvent = (function (_super) {
    __extends(ChannelEvent, _super);
    function ChannelEvent() {
        _super.apply(this, arguments);
    }
    return ChannelEvent;
}(Event));
var Midifile = (function () {
    function Midifile(data) {
        this.tracks = new Array();
        var ticksPerBeat;
        this.stream = new StringStream(data);
        var headerChunk = this.readChunk(this.stream);
        if (headerChunk.id !== "MThd" || headerChunk.length !== 6) {
            throw "Bad .mid file - header not found";
        }
        var headerStream = new StringStream(headerChunk.data);
        var formatType = headerStream.readInt16();
        var trackCount = headerStream.readInt16();
        var timeDivision = headerStream.readInt16();
        if (timeDivision & 0x8000) {
            throw "Expressing time division in SMTPE frames is not supported yet";
        }
        else {
            ticksPerBeat = timeDivision;
        }
        this.header = new MidiHeader(formatType, trackCount, ticksPerBeat);
        for (var i = 0; i < this.header.trackCount; i++) {
            this.tracks[i] = new Array();
            var trackChunk = this.readChunk(this.stream);
            if (trackChunk.id !== "MTrk") {
                throw "Unexpected chunk - expected MTrk, got " + trackChunk.id;
            }
            var trackStream = new StringStream(trackChunk.data);
            while (!trackStream.eof()) {
                var event = this.readEvent(trackStream);
                this.tracks[i].push(event);
            }
        }
    }
    Midifile.prototype.readChunk = function (stream) {
        var id = stream.read(4);
        var length = stream.readInt32();
        return new Chunk(id, length, stream.read(length));
    };
    Midifile.prototype.readEvent = function (stream) {
        var event = {};
        event.deltaTime = stream.readVarInt();
        var eventTypeByte = stream.readInt8();
        if ((eventTypeByte & 0xf0) === 0xf0) {
            /* system / meta event */
            var length;
            if (eventTypeByte === 0xff) {
                /* meta event */
                event.type = "meta";
                var subtypeByte = stream.readInt8();
                length = stream.readVarInt();
                switch (subtypeByte) {
                    case 0x00:
                        event.subtype = "sequenceNumber";
                        if (length !== 2)
                            throw "Expected length for sequenceNumber event is 2, got " + length;
                        event.number = stream.readInt16();
                        return event;
                    case 0x01:
                        event.subtype = "text";
                        event.text = stream.read(length);
                        return event;
                    case 0x02:
                        event.subtype = "copyrightNotice";
                        event.text = stream.read(length);
                        return event;
                    case 0x03:
                        event.subtype = "trackName";
                        event.text = stream.read(length);
                        return event;
                    case 0x04:
                        event.subtype = "instrumentName";
                        event.text = stream.read(length);
                        return event;
                    case 0x05:
                        event.subtype = "lyrics";
                        event.text = stream.read(length);
                        return event;
                    case 0x06:
                        event.subtype = "marker";
                        event.text = stream.read(length);
                        return event;
                    case 0x07:
                        event.subtype = "cuePoint";
                        event.text = stream.read(length);
                        return event;
                    case 0x20:
                        event.subtype = "midiChannelPrefix";
                        if (length !== 1)
                            throw "Expected length for midiChannelPrefix event is 1, got " + length;
                        event.channel = stream.readInt8();
                        return event;
                    case 0x2f:
                        event.subtype = "endOfTrack";
                        if (length !== 0)
                            throw "Expected length for endOfTrack event is 0, got " + length;
                        return event;
                    case 0x51:
                        event.subtype = "setTempo";
                        if (length !== 3)
                            throw "Expected length for setTempo event is 3, got " + length;
                        event.microsecondsPerBeat = ((stream.readInt8() << 16)
                            + (stream.readInt8() << 8)
                            + stream.readInt8());
                        return event;
                    case 0x54:
                        event.subtype = "smpteOffset";
                        if (length !== 5)
                            throw "Expected length for smpteOffset event is 5, got " + length;
                        var hourByte = stream.readInt8();
                        event.frameRate = {
                            0x00: 24, 0x20: 25, 0x40: 29, 0x60: 30
                        }[hourByte & 0x60];
                        event.hour = hourByte & 0x1f;
                        event.min = stream.readInt8();
                        event.sec = stream.readInt8();
                        event.frame = stream.readInt8();
                        event.subframe = stream.readInt8();
                        return event;
                    case 0x58:
                        event.subtype = "timeSignature";
                        if (length !== 4)
                            throw "Expected length for timeSignature event is 4, got " + length;
                        event.numerator = stream.readInt8();
                        event.denominator = Math.pow(2, stream.readInt8());
                        event.metronome = stream.readInt8();
                        event.thirtyseconds = stream.readInt8();
                        return event;
                    case 0x59:
                        event.subtype = "keySignature";
                        if (length !== 2)
                            throw "Expected length for keySignature event is 2, got " + length;
                        event.key = stream.readInt8(true);
                        event.scale = stream.readInt8();
                        return event;
                    case 0x7f:
                        event.subtype = "sequencerSpecific";
                        event.data = stream.read(length);
                        return event;
                    default:
                        // console.log("Unrecognised meta event subtype: " + subtypeByte);
                        event.subtype = "unknown";
                        event.data = stream.read(length);
                        return event;
                }
            }
            else if (eventTypeByte === 0xf0) {
                event.type = "sysEx";
                length = stream.readVarInt();
                event.data = stream.read(length);
                return event;
            }
            else if (eventTypeByte === 0xf7) {
                event.type = "dividedSysEx";
                length = stream.readVarInt();
                event.data = stream.read(length);
                return event;
            }
            else {
                throw "Unrecognised MIDI event type byte: " + eventTypeByte;
            }
        }
        else {
            /* channel event */
            var param1;
            if ((eventTypeByte & 0x80) === 0) {
                /* running status - reuse lastEventTypeByte as the event type.
                    eventTypeByte is actually the first parameter
                */
                param1 = eventTypeByte;
                eventTypeByte = this.lastEventTypeByte;
            }
            else {
                param1 = stream.readInt8();
                this.lastEventTypeByte = eventTypeByte;
            }
            var eventType = eventTypeByte >> 4;
            event.channel = eventTypeByte & 0x0f;
            event.type = "channel";
            switch (eventType) {
                case 0x08:
                    event.subtype = "noteOff";
                    event.noteNumber = param1;
                    event.velocity = stream.readInt8();
                    return event;
                case 0x09:
                    event.noteNumber = param1;
                    event.velocity = stream.readInt8();
                    if (event.velocity === 0) {
                        event.subtype = "noteOff";
                    }
                    else {
                        event.subtype = "noteOn";
                    }
                    return event;
                case 0x0a:
                    event.subtype = "noteAftertouch";
                    event.noteNumber = param1;
                    event.amount = stream.readInt8();
                    return event;
                case 0x0b:
                    event.subtype = "controller";
                    event.controllerType = param1;
                    event.value = stream.readInt8();
                    return event;
                case 0x0c:
                    event.subtype = "programChange";
                    event.programNumber = param1;
                    return event;
                case 0x0d:
                    event.subtype = "channelAftertouch";
                    event.amount = param1;
                    return event;
                case 0x0e:
                    event.subtype = "pitchBend";
                    event.value = param1 + (stream.readInt8() << 7);
                    return event;
                default:
                    throw "Unrecognised MIDI event type: " + eventType;
            }
        }
    };
    return Midifile;
}());
exports.Midifile = Midifile;
//function midiFile(data) {
//    var ticksPerBeat = 0;
//    function readChunk(stream: StringStream) {
//        var id = stream.read(4);
//        var length: number = stream.readInt32();
//        return new Chunk(id, length, stream.read(length));
//    }
//    var lastEventTypeByte;
//    function readEvent(stream) {
//        var event: IEvent;
//        event.deltaTime = stream.readVarInt();
//        var eventTypeByte = stream.readInt8();
//        if ((eventTypeByte & 0xf0) == 0xf0) {
//            /* system / meta event */
//            if (eventTypeByte == 0xff) {
//                /* meta event */
//                event.type = 'meta';
//                var subtypeByte = stream.readInt8();
//                var length = stream.readVarInt();
//                switch (subtypeByte) {
//                    case 0x00:
//                        event.subtype = 'sequenceNumber';
//                        if (length != 2) throw "Expected length for sequenceNumber event is 2, got " + length;
//                        event.number = stream.readInt16();
//                        return event;
//                    case 0x01:
//                        event.subtype = 'text';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x02:
//                        event.subtype = 'copyrightNotice';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x03:
//                        event.subtype = 'trackName';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x04:
//                        event.subtype = 'instrumentName';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x05:
//                        event.subtype = 'lyrics';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x06:
//                        event.subtype = 'marker';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x07:
//                        event.subtype = 'cuePoint';
//                        event.text = stream.read(length);
//                        return event;
//                    case 0x20:
//                        event.subtype = 'midiChannelPrefix';
//                        if (length != 1) throw "Expected length for midiChannelPrefix event is 1, got " + length;
//                        event.channel = stream.readInt8();
//                        return event;
//                    case 0x2f:
//                        event.subtype = 'endOfTrack';
//                        if (length != 0) throw "Expected length for endOfTrack event is 0, got " + length;
//                        return event;
//                    case 0x51:
//                        event.subtype = 'setTempo';
//                        if (length != 3) throw "Expected length for setTempo event is 3, got " + length;
//                        event.microsecondsPerBeat = (
//                            (stream.readInt8() << 16)
//                            + (stream.readInt8() << 8)
//                            + stream.readInt8()
//                        );
//                        return event;
//                    case 0x54:
//                        event.subtype = 'smpteOffset';
//                        if (length != 5) throw "Expected length for smpteOffset event is 5, got " + length;
//                        var hourByte = stream.readInt8();
//                        event.frameRate = {
//                            0x00: 24, 0x20: 25, 0x40: 29, 0x60: 30
//                        }[hourByte & 0x60];
//                        event.hour = hourByte & 0x1f;
//                        event.min = stream.readInt8();
//                        event.sec = stream.readInt8();
//                        event.frame = stream.readInt8();
//                        event.subframe = stream.readInt8();
//                        return event;
//                    case 0x58:
//                        event.subtype = 'timeSignature';
//                        if (length != 4) throw "Expected length for timeSignature event is 4, got " + length;
//                        event.numerator = stream.readInt8();
//                        event.denominator = Math.pow(2, stream.readInt8());
//                        event.metronome = stream.readInt8();
//                        event.thirtyseconds = stream.readInt8();
//                        return event;
//                    case 0x59:
//                        event.subtype = 'keySignature';
//                        if (length != 2) throw "Expected length for keySignature event is 2, got " + length;
//                        event.key = stream.readInt8(true);
//                        event.scale = stream.readInt8();
//                        return event;
//                    case 0x7f:
//                        event.subtype = 'sequencerSpecific';
//                        event.data = stream.read(length);
//                        return event;
//                    default:
//                        // console.log("Unrecognised meta event subtype: " + subtypeByte);
//                        event.subtype = 'unknown';
//                        event.data = stream.read(length);
//                        return event;
//                }
//                event.data = stream.read(length);
//                return event;
//            } else if (eventTypeByte == 0xf0) {
//                event.type = 'sysEx';
//                var length = stream.readVarInt();
//                event.data = stream.read(length);
//                return event;
//            } else if (eventTypeByte == 0xf7) {
//                event.type = 'dividedSysEx';
//                var length = stream.readVarInt();
//                event.data = stream.read(length);
//                return event;
//            } else {
//                throw "Unrecognised MIDI event type byte: " + eventTypeByte;
//            }
//        } else {
//            /* channel event */
//            var param1;
//            if ((eventTypeByte & 0x80) == 0) {
//				/* running status - reuse lastEventTypeByte as the event type.
//					eventTypeByte is actually the first parameter
//				*/
//                param1 = eventTypeByte;
//                eventTypeByte = lastEventTypeByte;
//            } else {
//                param1 = stream.readInt8();
//                lastEventTypeByte = eventTypeByte;
//            }
//            var eventType = eventTypeByte >> 4;
//            event.channel = eventTypeByte & 0x0f;
//            event.type = 'channel';
//            switch (eventType) {
//                case 0x08:
//                    event.subtype = 'noteOff';
//                    event.noteNumber = param1;
//                    event.velocity = stream.readInt8();
//                    return event;
//                case 0x09:
//                    event.noteNumber = param1;
//                    event.velocity = stream.readInt8();
//                    if (event.velocity == 0) {
//                        event.subtype = 'noteOff';
//                    } else {
//                        event.subtype = 'noteOn';
//                    }
//                    return event;
//                case 0x0a:
//                    event.subtype = 'noteAftertouch';
//                    event.noteNumber = param1;
//                    event.amount = stream.readInt8();
//                    return event;
//                case 0x0b:
//                    event.subtype = 'controller';
//                    event.controllerType = param1;
//                    event.value = stream.readInt8();
//                    return event;
//                case 0x0c:
//                    event.subtype = 'programChange';
//                    event.programNumber = param1;
//                    return event;
//                case 0x0d:
//                    event.subtype = 'channelAftertouch';
//                    event.amount = param1;
//                    return event;
//                case 0x0e:
//                    event.subtype = 'pitchBend';
//                    event.value = param1 + (stream.readInt8() << 7);
//                    return event;
//                default:
//                    throw "Unrecognised MIDI event type: " + eventType;
//                /* 
//                console.log("Unrecognised MIDI event type: " + eventType);
//                stream.readInt8();
//                event.subtype = 'unknown';
//                return event;
//                */
//            }
//        }
//    }
//    var stream = new StringStream(data);
//    var headerChunk = readChunk(stream);
//    if (headerChunk.id != 'MThd' || headerChunk.length != 6) {
//        throw "Bad .mid file - header not found";
//    }
//    var headerStream = new StringStream(headerChunk.data);
//    var formatType = headerStream.readInt16();
//    var trackCount = headerStream.readInt16();
//    var timeDivision = headerStream.readInt16();
//    if (timeDivision & 0x8000) {
//        throw "Expressing time division in SMTPE frames is not supported yet";
//    } else {
//        ticksPerBeat = timeDivision;
//    }
//    var header: IMidiheader = {
//        'formatType': formatType,
//        'trackCount': trackCount,
//        'ticksPerBeat': ticksPerBeat
//    };
//    var tracks = [];
//    for (var i = 0; i < header.trackCount; i++) {
//        tracks[i] = [];
//        var trackChunk = readChunk(stream);
//        if (trackChunk.id != 'MTrk') {
//            throw "Unexpected chunk - expected MTrk, got " + trackChunk.id;
//        }
//        var trackStream = new StringStream(trackChunk.data);
//        while (!trackStream.eof()) {
//            var event = readEvent(trackStream);
//            tracks[i].push(event);
//            //console.log(event);
//        }
//    }
//    return {
//        'header': header,
//        'tracks': tracks
//    };
//};
/* Wrapper for accessing strings through sequential reads */
var StringStream = (function () {
    function StringStream(inputstring) {
        this.position = 0;
        this.str = inputstring;
    }
    StringStream.prototype.read = function (length) {
        var result = this.str.substr(this.position, length);
        this.position += length;
        return result;
    };
    /* read a big-endian 32-bit integer */
    StringStream.prototype.readInt32 = function () {
        var result = ((this.str.charCodeAt(this.position) << 24)
            + (this.str.charCodeAt(this.position + 1) << 16)
            + (this.str.charCodeAt(this.position + 2) << 8)
            + this.str.charCodeAt(this.position + 3));
        this.position += 4;
        return result;
    };
    /* read a big-endian 16-bit integer */
    StringStream.prototype.readInt16 = function () {
        var result = ((this.str.charCodeAt(this.position) << 8)
            + this.str.charCodeAt(this.position + 1));
        this.position += 2;
        return result;
    };
    /* read an 8-bit integer */
    StringStream.prototype.readInt8 = function (signed) {
        var result = this.str.charCodeAt(this.position);
        if (signed && result > 127) {
            result -= 256;
        }
        this.position += 1;
        return result;
    };
    StringStream.prototype.eof = function () {
        return this.position >= this.str.length;
    };
    /* read a MIDI-style variable-length integer
        (big-endian value in groups of 7 bits,
        with top bit set to signify that another byte follows)
    */
    StringStream.prototype.readVarInt = function () {
        var result = 0;
        while (true) {
            var b = this.readInt8();
            if (b & 0x80) {
                result += (b & 0x7f);
                result <<= 7;
            }
            else {
                /* b is the last byte */
                return result + b;
            }
        }
    };
    return StringStream;
}());
/* Wrapper for accessing strings through sequential reads */
//function Stream(str) {
//    var position = 0;
//    function read(length) {
//        var result = str.substr(position, length);
//        position += length;
//        return result;
//    }
//    /* read a big-endian 32-bit integer */
//    function readInt32() {
//        var result = (
//            (str.charCodeAt(position) << 24)
//            + (str.charCodeAt(position + 1) << 16)
//            + (str.charCodeAt(position + 2) << 8)
//            + str.charCodeAt(position + 3));
//        position += 4;
//        return result;
//    }
//    /* read a big-endian 16-bit integer */
//    function readInt16() {
//        var result = (
//            (str.charCodeAt(position) << 8)
//            + str.charCodeAt(position + 1));
//        position += 2;
//        return result;
//    }
//    /* read an 8-bit integer */
//    function readInt8(signed) {
//        var result = str.charCodeAt(position);
//        if (signed && result > 127) result -= 256;
//        position += 1;
//        return result;
//    }
//    function eof() {
//        return position >= str.length;
//    }
//	/* read a MIDI-style variable-length integer
//		(big-endian value in groups of 7 bits,
//		with top bit set to signify that another byte follows)
//	*/
//    function readVarInt() {
//        var result = 0;
//        while (true) {
//            var b = readInt8();
//            if (b & 0x80) {
//                result += (b & 0x7f);
//                result <<= 7;
//            } else {
//                /* b is the last byte */
//                return result + b;
//            }
//        }
//    }
//    return {
//        'eof': eof,
//        'read': read,
//        'readInt32': readInt32,
//        'readInt16': readInt16,
//        'readInt8': readInt8,
//        'readVarInt': readVarInt
//    };
//}
//# sourceMappingURL=MidiFile.js.map