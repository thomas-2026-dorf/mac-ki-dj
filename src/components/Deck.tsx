type DeckProps = {
    title: string;
};

export default function Deck({ title }: DeckProps) {
    return <div>{title}</div>;
}