module z_tb;
    logic b;
    initial begin
        b = 0;
        #10 $finish;
    end
endmodule
