interface Midi {
    header?: Midiheader;
    tracks?: track[][];
}
interface Midiheader {
    formatType?:number,
    ticksPerBeat?: number,
    trackCount?: number
}
interface track {
    deltaTime:number,
    type:string,
    subtype:string,

    key?:number
    scale?:number

    text?:string,
    channel?:number,
    programNumber?:number,
    controllerType?:number,

    numerator?:number,
    denominator?:number,
    metronome?:number,
    thirtyseconds?:number,

    microsecondsPerBeat?:number,

    value?:number,

    noteNumber?:number,
    velocity?:number,

}
interface timesignature extends meta
{

}
interface meta extends track{

}
interface channel {

}
interface keySignature extends meta
{

}
interface setTempo extends meta
{

}

export {Midi};