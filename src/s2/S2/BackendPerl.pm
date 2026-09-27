#!/usr/bin/perl
#

package S2::BackendPerl;

use strict;
use S2::Indenter;

sub new {
    my ($class, $l, $layerID, $untrusted, $oo, $sourcename) = @_;
    my $this = {
        'layer' => $l,
        'layerID' => $layerID,
        'untrusted' => $untrusted,
        'package' => '',
        'oo' => $oo,
        'sourcename' => $sourcename,
    };
    bless $this, $class;
}

sub getBuiltinPackage { shift->{'package'}; }
sub setBuiltinPackage { my $t = shift; $t->{'package'} = shift; }

sub getLayerID { shift->{'layerID'}; }
sub getLayerIDString { shift->{'layerID'}; }

sub untrusted { shift->{'untrusted'}; }

sub oo { shift->{oo}; }

sub output {
    my ($this, $o) = @_;
    my $io = new S2::Indenter $o, 4;

    $io->writeln("#!/usr/bin/perl");
    $io->writeln("# auto-generated Perl code from input S2 code"); 
    if ($this->oo) {
        $io->writeln("use S2::Runtime::OO;");
        $io->writeln("use strict;");
        $io->writeln('my $lay = new S2::Runtime::OO::Layer;');
        $io->writeln('$lay->set_source_name('.$this->quoteString($this->{sourcename}).');');
        my $nodes = $this->{'layer'}->getNodes();
        foreach my $n (@$nodes) {
            $n->asPerl($this, $io);
        }
        $io->writeln('$lay;');
    }
    else {
        $io->writeln("package S2;");
        $io->writeln("use strict;");
        $io->writeln("register_layer($this->{'layerID'});");
        my $nodes = $this->{'layer'}->getNodes();
        foreach my $n (@$nodes) {
            $n->asPerl($this, $io);
        }
        $io->writeln("1;");
        $io->writeln("# end.");
    }
}

# Opt-in position collection executes the normal emitter on the same checked AST.
# Local wrappers only record output positions; native bytes and legacy output stay unchanged.
sub collectNativePositions {
    my ($this, $o) = @_;
    my @classes = map { "S2::$_" } qw(NodeExprStmt NodeVarDeclStmt NodePrintStmt
        NodeReturnStmt NodePushStmt NodeDeleteStmt NodeBranchStmt NodeIfStmt
        NodeWhileStmt NodeForStmt NodeForeachStmt NodeStmtBlock NodeFunction NodeArrayLiteral);
    my $install;
    $install = sub {
        my ($at) = @_;
        return $this->output($o) if $at == @classes;
        my $class = $classes[$at];
        my $original = $class->can('asPerl');
        return $install->($at + 1) unless $original;
        no strict 'refs';
        no warnings 'redefine';
        local *{"${class}::asPerl"} = sub {
            my ($node, $bp, $writer, @rest) = @_;
            my $line = $writer->lineNumber;
            $node->{native_cop_line} = $line;
            my $offset = length ${$o->[0]};
            $original->($node, $bp, $writer, @rest);
            $node->{native_first_value_line} = $line + 1 if $class eq 'S2::NodeArrayLiteral' && @{$node->{vals}};
            if ($class eq 'S2::NodeFunction') {
                my $chunk = substr(${$o->[0]}, $offset);
                if ($chunk =~ /S2::check_depth\(\) if \+\+\$S2::sub_ctr/) {
                    my $prefix = substr($chunk, 0, $-[0]);
                    $node->{native_entry_line} = $line + ($prefix =~ tr/\n/\n/);
                }
            }
            if ($class eq 'S2::NodeIfStmt') {
                # Perl optimizes a single then statement into the header COP.
                my $share;
                $share = sub {
                    my ($block, $cop) = @_;
                    my $statements = $block->{stmtlist};
                    return unless @$statements == 1;
                    my $only = $statements->[0];
                    if ($only->isa('S2::NodeIfStmt')) {
                        $share->($only->{thenblock}, $cop);
                        $share->($_, $cop) for @{$only->{elseifblocks}};
                    } elsif (!$only->isa('S2::NodeWhileStmt') && !$only->isa('S2::NodeForStmt') &&
                        !$only->isa('S2::NodeForeachStmt')) {
                        $only->{native_cop_line} = $cop;
                    }
                };
                $share->($node->{thenblock}, $line);
                $share->($_, $line) for @{$node->{elseifblocks}};
            }
            if ($class eq 'S2::NodeForeachStmt') {
                my $expr=$node->{listexpr};
                while (ref($expr) && ($expr->{expr} || $expr->{subExpr})) {
                    $expr=$expr->{expr} || $expr->{subExpr};
                }
                $node->{native_cop_line}=$expr->{native_first_value_line}
                    if ref($expr) && $expr->isa('S2::NodeArrayLiteral') && $expr->{native_first_value_line};
            }
            if ($class eq 'S2::NodeForStmt') {
                my $statements=$node->{stmts}{stmtlist};
                $statements->[0]{native_cop_line}=$line if @$statements==1;
            }
        };
        return $install->($at + 1);
    };
    $install->(0);
}

sub quoteString {
    shift if ref $_[0];
    my $s = shift;
    return "\"" . quoteStringInner($s) . "\"";
}

sub quoteStringInner {
    my $s = shift;
    $s =~ s/([\\\$\"\@])/\\$1/g;
    $s =~ s/\n/\\n/g;
    return $s;
}


1;
