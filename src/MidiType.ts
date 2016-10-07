interface IMidi {
    header?: IMidiheader;
    tracks?: ITrack[][];
}
interface IMidiheader {
    formatType?:number,
    ticksPerBeat?: number,
    trackCount?: number,
}
interface ITrack {
    deltaTime:number,
    type:string,
    subtype:string,

    key?:number,
    scale?:number,

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

export {IMidi as Midi};